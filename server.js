const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.options('*', cors());

const CLIENT_ID = '68aa02bb60ef4003a30ee6286850ab8c';
const CLIENT_SECRET = '757007633def4a4089b215a5e764061c';
const APP_ID = 1377;
const AUTH_URL = 'https://auth.sandboxappmax.com.br/oauth2/token';
const API_URL = 'https://api.sandboxappmax.com.br';

let merchantToken = null;

async function getAppToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);
  const resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Token não obtido: ' + JSON.stringify(data));
  return data.access_token;
}

async function getAccessToken() {
  // Se já temos merchant token em cache, usar
  if (merchantToken) return merchantToken;

  const appToken = await getAppToken();

  // Chamar /app/authorize com os campos corretos
  const authResp = await fetch(`${API_URL}/app/authorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${appToken}`
    },
    body: JSON.stringify({
      app_id: APP_ID,
      url_callback: 'https://portaldopassaporte.com.br'
    })
  });
  const authData = await authResp.json();
  console.log('Authorize:', JSON.stringify(authData));

  // Pegar o hash/token retornado
  const hash = authData.hash || authData.data?.hash || authData.token || authData.data?.token;

  if (hash) {
    // Gerar credenciais do merchant com o hash
    const genResp = await fetch(`https://api.appmax.com.br/app/client/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        hash
      })
    });
    const genData = await genResp.json();
    console.log('Generate:', JSON.stringify(genData));
    merchantToken = genData.access_token || genData.token || appToken;
  } else {
    // Se não tem hash, usar o appToken diretamente
    merchantToken = appToken;
  }

  return merchantToken;
}

app.get('/ping', (req, res) => res.json({ pong: true }));

app.get('/diagnostico', async (req, res) => {
  try {
    merchantToken = null; // resetar cache para testar
    const appToken = await getAppToken();

    const authResp = await fetch(`${API_URL}/app/authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`
      },
      body: JSON.stringify({
        app_id: APP_ID,
        url_callback: 'https://portaldopassaporte.com.br'
      })
    });
    const authData = await authResp.json();
    console.log('Authorize:', JSON.stringify(authData));

    res.json({ authorize_response: authData });
  } catch(err) {
    res.json({ error: err.message });
  }
});

app.post('/gerar-boleto', async (req, res) => {
  try {
    const { nome, email, cpf, telefone, cep, logradouro, numero, bairro, cidade, estado } = req.body;
    const token = await getAccessToken();

    const clienteResp = await fetch(`${API_URL}/api/v1/customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        firstname: nome.split(' ')[0],
        lastname: nome.split(' ').slice(1).join(' ') || 'Portal',
        email, document_number: cpf.replace(/\D/g, ''),
        phone: telefone.replace(/\D/g, ''),
        postcode: cep.replace(/\D/g, ''),
        street: logradouro, street_number: numero || 'SN',
        neighborhood: bairro, city: cidade, state: estado
      })
    });
    const cliente = await clienteResp.json();
    const customer_id = cliente.id || cliente.data?.id;
    if (!customer_id) throw new Error('Cliente não criado: ' + JSON.stringify(cliente));

    const pedidoResp = await fetch(`${API_URL}/api/v1/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        customer_id,
        products: [{ sku: 'ASSESSORIA-001', name: 'Assessoria Portal do Passaporte', price: 29687, qty: 1 }]
      })
    });
    const pedido = await pedidoResp.json();
    const cart_id = pedido.cart_id || pedido.data?.cart_id;
    if (!cart_id) throw new Error('Pedido não criado: ' + JSON.stringify(pedido));

    const boletoResp = await fetch(`${API_URL}/api/v1/payment/billet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ cart_id, days_due_date: 3 })
    });
    const boleto = await boletoResp.json();

    res.json({
      success: true,
      linha_digitavel: boleto.billet_digitable_line || boleto.data?.billet_digitable_line || 'Não disponível',
      url_pdf: boleto.billet_url || boleto.data?.billet_url || '#'
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
