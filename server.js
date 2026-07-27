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

// Passo 1: Token do app
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

app.get('/ping', (req, res) => res.json({ pong: true }));

// Diagnóstico completo - mostra o que /app/authorize retorna
app.get('/diagnostico', async (req, res) => {
  try {
    const token = await getAppToken();
    console.log('Token OK:', token.substring(0, 30));

    // Tentar /app/authorize
    const authResp = await fetch(`${API_URL}/app/authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        redirect_uri: 'https://portaldopassaporte.com.br',
        scope: 'all'
      })
    });
    const authText = await authResp.text();
    console.log('Authorize response:', authText);

    // Tentar também sem body
    const authResp2 = await fetch(`${API_URL}/app/authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ client_id: CLIENT_ID })
    });
    const authText2 = await authResp2.text();

    res.json({
      token_preview: token.substring(0, 50) + '...',
      authorize_response_1: authText,
      authorize_response_2: authText2
    });
  } catch(err) {
    res.json({ error: err.message });
  }
});

app.post('/gerar-boleto', async (req, res) => {
  try {
    const { nome, email, cpf, telefone, cep, logradouro, numero, bairro, cidade, estado } = req.body;
    const token = await getAppToken();

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
    const cliente = JSON.parse(clienteText);
    const customer_id = cliente.id || cliente.data?.id;
    if (!customer_id) throw new Error('Cliente não criado: ' + clienteText);

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
