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

// Cache das credenciais do merchant
let merchantCredentials = null;

// Passo 1: Obter token do app
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
  const text = await resp.text();
  console.log('App token response:', text);
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('Token do app não obtido: ' + text);
  return data.access_token;
}

// Passo 2: Gerar hash de autorização
async function getAuthHash(appToken) {
  const resp = await fetch(`${API_URL}/app/authorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${appToken}`
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      redirect_uri: 'https://portaldopassaporte.com.br',
      scope: 'all'
    })
  });
  const text = await resp.text();
  console.log('Auth hash response:', text);
  const data = JSON.parse(text);
  return data.hash || data.data?.hash || data.authorization_code || data.code;
}

// Passo 3: Gerar credenciais do merchant
async function getMerchantCredentials(hash) {
  const resp = await fetch(`https://api.appmax.com.br/app/client/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      hash: hash
    })
  });
  const text = await resp.text();
  console.log('Merchant credentials response:', text);
  const data = JSON.parse(text);
  return data;
}

// Obter token de acesso final para chamadas da API
async function getAccessToken() {
  const appToken = await getAppToken();
  return appToken; // Usar o appToken diretamente para API sandbox
}

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.get('/ping', (req, res) => res.json({ pong: true }));

// Rota de diagnóstico - testa o fluxo de autenticação completo
app.get('/diagnostico', async (req, res) => {
  try {
    const appToken = await getAppToken();
    console.log('App token OK:', appToken.substring(0, 30) + '...');

    // Testar chamada simples à API
    const testResp = await fetch(`${API_URL}/api/v1/customer`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${appToken}` }
    });
    const testText = await testResp.text();
    console.log('Test API response:', testText);

    res.json({
      app_token: appToken.substring(0, 30) + '...',
      api_test: testText.substring(0, 200)
    });
  } catch(err) {
    res.json({ error: err.message });
  }
});

app.post('/gerar-boleto', async (req, res) => {
  try {
    const { nome, email, cpf, telefone, cep, logradouro, numero, bairro, cidade, estado } = req.body;
    console.log('Gerando boleto para:', nome, email);

    const token = await getAccessToken();

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
    console.log('Cliente:', clienteText);
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
    console.log('Pedido:', pedidoText);
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
    console.log('Boleto:', boletoText);
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
