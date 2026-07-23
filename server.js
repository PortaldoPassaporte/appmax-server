const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.options('*', cors());

const CLIENT_ID = '68aa02bb60ef4003a30ee6286850ab8c';
const CLIENT_SECRET = '757007633def4a4089b215a5e764061c';
const AUTH_URL = 'https://auth.sandboxappmax.com.br/oauth2/token';
const API_URL = 'https://api.sandboxappmax.com.br';

async function getAccessToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);

  const resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const text = await resp.text();
  console.log('Auth response:', text);
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('Token não obtido: ' + text);
  return data.access_token;
}

app.get('/', (req, res) => res.json({ status: 'ok', message: 'Portal do Passaporte - AppMax Server' }));
app.get('/ping', (req, res) => res.json({ pong: true }));

app.post('/gerar-boleto', async (req, res) => {
  try {
    const { nome, email, cpf, telefone, cep, logradouro, numero, bairro, cidade, estado } = req.body;
    console.log('Gerando boleto para:', nome, email);

    const token = await getAccessToken();
    console.log('Token OK');

    // Criar cliente
    const clienteResp = await fetch(`${API_URL}/api/v1/customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        firstname: nome.split(' ')[0],
        lastname: nome.split(' ').slice(1).join(' ') || 'Portal',
        email,
        document_number: cpf.replace(/\D/g, ''),
        phone: telefone.replace(/\D/g, ''),
        postcode: cep.replace(/\D/g, ''),
        street: logradouro,
        street_number: numero || 'SN',
        neighborhood: bairro,
        city: cidade,
        state: estado
      })
    });
    const clienteText = await clienteResp.text();
    console.log('Cliente response:', clienteText);
    const cliente = JSON.parse(clienteText);
    const customer_id = cliente.id || cliente.data?.id;
    if (!customer_id) throw new Error('Cliente não criado: ' + clienteText);

    // Criar pedido
    const pedidoResp = await fetch(`${API_URL}/api/v1/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        customer_id,
        products: [{ sku: 'ASSESSORIA-001', name: 'Assessoria Portal do Passaporte', price: 29687, qty: 1 }]
      })
    });
    const pedidoText = await pedidoResp.text();
    console.log('Pedido response:', pedidoText);
    const pedido = JSON.parse(pedidoText);
    const cart_id = pedido.cart_id || pedido.data?.cart_id;
    if (!cart_id) throw new Error('Pedido não criado: ' + pedidoText);

    // Gerar boleto
    const boletoResp = await fetch(`${API_URL}/api/v1/payment/billet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ cart_id, days_due_date: 3 })
    });
    const boletoText = await boletoResp.text();
    console.log('Boleto response:', boletoText);
    const boleto = JSON.parse(boletoText);

    res.json({
      success: true,
      linha_digitavel: boleto.billet_digitable_line || boleto.data?.billet_digitable_line || 'Não disponível',
      url_pdf: boleto.billet_url || boleto.data?.billet_url || '#'
    });

  } catch (err) {
    console.error('Erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
