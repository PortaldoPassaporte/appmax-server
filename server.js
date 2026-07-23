const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(express.json());

// CORS liberado para qualquer origem
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

// Credenciais AppMax (sandbox/homologação)
const CLIENT_ID = '68aa02bb60ef4003a30ee6286850ab8c';
const CLIENT_SECRET = '757007633def4a4089b215a5e764061c';
const BASE_URL = 'https://breakingcode.sandboxappmax.com.br';

// Função para obter token OAuth
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
  console.log('Token response:', JSON.stringify(data));
  if (!data.access_token) throw new Error('Token não obtido: ' + JSON.stringify(data));
  return data.access_token;
}

// Rota de verificação (acordar o servidor)
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Portal do Passaporte - Servidor AppMax ativo!' });
});

app.get('/ping', (req, res) => {
  res.json({ pong: true });
});

// Rota principal - gerar boleto
app.post('/gerar-boleto', async (req, res) => {
  try {
    const { nome, email, cpf, telefone, cep, logradouro, numero, bairro, cidade, estado } = req.body;
    console.log('Requisição recebida:', { nome, email, cpf });

    const token = await getAccessToken();
    console.log('Token obtido com sucesso');

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
    console.log('Cliente criado:', JSON.stringify(cliente));

    const customer_id = cliente.id || cliente.data?.id;
    if (!customer_id) throw new Error('Cliente não criado: ' + JSON.stringify(cliente));

    // 2. Criar pedido
    const pedidoResp = await fetch(`${BASE_URL}/api/v1/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        customer_id,
        products: [{
          sku: 'ASSESSORIA-001',
          name: 'Assessoria Portal do Passaporte',
          price: 29687,
          qty: 1
        }]
      })
    });
    const pedido = await pedidoResp.json();
    console.log('Pedido criado:', JSON.stringify(pedido));

    const cart_id = pedido.cart_id || pedido.data?.cart_id;
    if (!cart_id) throw new Error('Pedido não criado: ' + JSON.stringify(pedido));

    // 3. Gerar boleto
    const boletoResp = await fetch(`${BASE_URL}/api/v1/payment/billet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        cart_id,
        days_due_date: 3
      })
    });
    const boleto = await boletoResp.json();
    console.log('Boleto:', JSON.stringify(boleto));

    const linha = boleto.billet_digitable_line || boleto.data?.billet_digitable_line;
    const url = boleto.billet_url || boleto.data?.billet_url;

    res.json({
      success: true,
      linha_digitavel: linha || 'Linha não disponível',
      url_pdf: url || '#'
    });

  } catch (err) {
    console.error('Erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
