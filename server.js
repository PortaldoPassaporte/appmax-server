const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Credenciais AppMax (sandbox)
const CLIENT_ID = '68aa02bb60ef4003a30ee6286850ab8c';
const CLIENT_SECRET = '757007633def4a4089b215a5e764061c';
const BASE_URL = 'https://breakingcode.sandboxappmax.com.br';

// Função para obter token de acesso
async function getAccessToken() {
  const resp = await fetch(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });
  const data = await resp.json();
  return data.access_token;
}

// Rota principal - gerar boleto
app.post('/gerar-boleto', async (req, res) => {
  try {
    const { nome, email, cpf, telefone, cep, logradouro, numero, bairro, cidade, estado } = req.body;

    const token = await getAccessToken();

    // 1. Criar cliente
    const clienteResp = await fetch(`${BASE_URL}/api/v1/customer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        firstname: nome.split(' ')[0],
        lastname: nome.split(' ').slice(1).join(' ') || 'Portal',
        email,
        document_number: cpf.replace(/\D/g, ''),
        phone: telefone.replace(/\D/g, ''),
        postcode: cep.replace(/\D/g, ''),
        street: logradouro,
        street_number: numero || 'S/N',
        neighborhood: bairro,
        city: cidade,
        state: estado
      })
    });
    const cliente = await clienteResp.json();
    console.log('Cliente:', cliente);

    // 2. Criar pedido
    const pedidoResp = await fetch(`${BASE_URL}/api/v1/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        customer_id: cliente.id || cliente.data?.id,
        products: [{
          sku: 'ASSESSORIA-001',
          name: 'Assessoria — Portal do Passaporte',
          price: 29687, // valor em centavos
          qty: 1
        }]
      })
    });
    const pedido = await pedidoResp.json();
    console.log('Pedido:', pedido);

    // 3. Gerar boleto
    const boletoResp = await fetch(`${BASE_URL}/api/v1/payment/billet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        cart_id: pedido.cart_id || pedido.data?.cart_id,
        days_due_date: 3
      })
    });
    const boleto = await boletoResp.json();
    console.log('Boleto:', boleto);

    res.json({
      success: true,
      linha_digitavel: boleto.billet_digitable_line || boleto.data?.billet_digitable_line,
      url_pdf: boleto.billet_url || boleto.data?.billet_url
    });

  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota de verificação
app.get('/', (req, res) => {
  res.json({ status: 'Portal do Passaporte - Servidor AppMax ativo!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
