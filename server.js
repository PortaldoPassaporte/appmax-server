const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.options('*', cors());

// ===================================================================
// CREDENCIAIS DO APLICATIVO (App Store) — servem SÓ para autorizar a
// instalação (etapas /app/authorize e /app/client/generate).
// NÃO servem para criar cliente/pedido/boleto.
// ===================================================================
const APP_CLIENT_ID = 'ab0b5d70b55c44e1a5af6769412c3b2b';
const APP_CLIENT_SECRET = 'e677f625c5d64b84b137bd76262e4b8d';

// PREENCHER: o "App UUID" do seu aplicativo (não é o Client ID, nem o
// "Numerical ID"). Procure no painel da Appmax, na página do app, algo
// como "8f2c1d3e-5a4b-4c7d-9e1f-2a3b4c5d6e7f". Na documentação, veja o
// link "Identificadores e URLs do app" no menu lateral esquerdo.
const APP_UUID = process.env.APP_UUID || 'faf7d2ad-c88f-47db-8aec-0d14cea4535a';

// Uma chave fixa que identifica esta instalação (pode ser qualquer texto)
const EXTERNAL_KEY = 'portaldopassaporte-loja-01';

// Endereço do seu próprio servidor no Render
const BASE_URL = process.env.BASE_URL || 'https://appmax-server.onrender.com';
const URL_CALLBACK = `${BASE_URL}/callback`;

const AUTH_URL = 'https://auth.appmax.com.br/oauth2/token';
const API_URL = 'https://api.appmax.com.br';
const REDIRECT_BASE = 'https://admin.appmax.com.br/appstore/integration';

// Identificador fixo e único desta loja — gerado uma vez e mantido sempre igual.
// Depois de rodar pela primeira vez, copie o valor logado no console para a
// variável de ambiente EXTERNAL_ID no Render, assim ele nunca muda.
const EXTERNAL_ID = process.env.EXTERNAL_ID || crypto.randomUUID();
console.log('EXTERNAL_ID desta loja (guarde este valor):', EXTERNAL_ID);

// Credenciais do MERCHANT (da loja) — só existem DEPOIS de completar a
// instalação em /instalar. Depois de gerado, copie para as variáveis de
// ambiente MERCHANT_CLIENT_ID e MERCHANT_CLIENT_SECRET no Render.
let MERCHANT_CLIENT_ID = process.env.MERCHANT_CLIENT_ID || null;
let MERCHANT_CLIENT_SECRET = process.env.MERCHANT_CLIENT_SECRET || null;

// ===== Token do APLICATIVO (usado só para autorizar a instalação) =====
async function getAppAccessToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', APP_CLIENT_ID);
  params.append('client_secret', APP_CLIENT_SECRET);

  const resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const text = await resp.text();
  console.log('Auth (app) response:', text);
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('Token do app não obtido: ' + text);
  return data.access_token;
}

// ===== Token do MERCHANT (usado para criar cliente/pedido/boleto) =====
async function getMerchantAccessToken() {
  if (!MERCHANT_CLIENT_ID || !MERCHANT_CLIENT_SECRET) {
    throw new Error('Credenciais do merchant ainda não configuradas. Complete a instalação em /instalar primeiro.');
  }
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', MERCHANT_CLIENT_ID);
  params.append('client_secret', MERCHANT_CLIENT_SECRET);

  const resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const text = await resp.text();
  console.log('Auth (merchant) response:', text);
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('Token do merchant não obtido: ' + text);
  return data.access_token;
}

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.get('/ping', (req, res) => res.json({ pong: true }));

// ===================================================================
// URL DE VALIDAÇÃO (health check da Appmax)
// Cadastre esta URL como "URL de validação" no painel do app na Appmax:
//   https://appmax-server.onrender.com/health-check
// ===================================================================
app.post('/health-check', (req, res) => {
  console.log('Health check recebido da Appmax:', req.body);
  res.status(200).json({ external_id: EXTERNAL_ID, alias: 'Portal do Passaporte' });
});

// ===================================================================
// URL DE WEBHOOK (campo obrigatório no painel) — por enquanto só
// registra o evento recebido no log. Cadastre no painel como:
//   https://appmax-server.onrender.com/webhook
// ===================================================================
app.post('/webhook', (req, res) => {
  console.log('Webhook recebido da Appmax:', req.body);
  res.status(200).json({ received: true });
});

// ===================================================================
// ETAPA 1 (rodar uma única vez): abra esta URL no navegador para
// começar a instalação:
//   https://appmax-server.onrender.com/instalar
// ===================================================================
app.get('/instalar', async (req, res) => {
  try {
    if (APP_UUID === 'PREENCHER_APP_UUID_AQUI') {
      return res.status(400).send('<h2>Falta configurar o APP_UUID</h2><p>Encontre o "App UUID" no painel da Appmax e cole no código (ou na variável de ambiente APP_UUID no Render).</p>');
    }

    const appToken = await getAppAccessToken();

    const authResp = await fetch(`${API_URL}/app/authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`
      },
      body: JSON.stringify({
        app_id: APP_UUID,
        external_key: EXTERNAL_KEY,
        url_callback: URL_CALLBACK
      })
    });
    const authText = await authResp.text();
    console.log('Resposta /app/authorize:', authText);
    const authData = JSON.parse(authText);
    const hash = authData.data && authData.data.token;
    if (!hash) throw new Error('Hash não gerado: ' + authText);

    const redirectUrl = `${REDIRECT_BASE}/${hash}`;
    res.send(`
      <h2>Instalação iniciada!</h2>
      <p>Clique no link abaixo, faça login como lojista na Appmax e clique em autorizar:</p>
      <p><a href="${redirectUrl}" target="_blank">${redirectUrl}</a></p>
      <p>Depois de autorizar, você será redirecionado de volta automaticamente e as credenciais serão geradas.</p>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// ETAPA 2 (automática): a Appmax redireciona o navegador para cá depois
// que você autoriza a instalação como lojista.
// ===================================================================
app.get('/callback', async (req, res) => {
  try {
    console.log('Callback recebido, parâmetros:', req.query);

    // A Appmax deve mandar o hash de volta aqui — tentamos os nomes mais
    // prováveis. Se não achar, mostramos os parâmetros recebidos na tela.
    const hash = req.query.hash || req.query.token || req.query.code;
    if (!hash) {
      return res.send(`
        <h2>Callback recebido, mas não achei o hash</h2>
        <p>Copie esta tela e me mande — vou ajustar o código para pegar o campo certo:</p>
        <pre>${JSON.stringify(req.query, null, 2)}</pre>
      `);
    }

    const appToken = await getAppAccessToken();
    const genResp = await fetch(`${API_URL}/app/client/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`
      },
      body: JSON.stringify({ token: hash })
    });
    const genText = await genResp.text();
    console.log('Resposta /app/client/generate:', genText);
    const genData = JSON.parse(genText);
    const client = genData.data && genData.data.client;
    if (!client) throw new Error('Credenciais do merchant não geradas: ' + genText);

    MERCHANT_CLIENT_ID = client.client_id;
    MERCHANT_CLIENT_SECRET = client.client_secret;

    res.send(`
      <h2>✅ Instalação concluída!</h2>
      <p>Copie estas duas informações e cadastre como variáveis de ambiente no Render
      (nomes exatos: <b>MERCHANT_CLIENT_ID</b> e <b>MERCHANT_CLIENT_SECRET</b>),
      depois faça o redeploy do servidor:</p>
      <p><b>MERCHANT_CLIENT_ID:</b> ${MERCHANT_CLIENT_ID}</p>
      <p><b>MERCHANT_CLIENT_SECRET:</b> ${MERCHANT_CLIENT_SECRET}</p>
      <p>Também cadastre <b>EXTERNAL_ID</b> = ${EXTERNAL_ID} como variável de ambiente, para ele nunca mudar.</p>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// GERAR BOLETO — agora usa as credenciais do MERCHANT, não do app
// ===================================================================
app.post('/gerar-boleto', async (req, res) => {
  try {
    const { nome, email, cpf, telefone, cep, logradouro, numero, bairro, cidade, estado } = req.body;
    console.log('Gerando boleto para:', nome, email);

    const token = await getMerchantAccessToken();
    console.log('Token do merchant obtido:', token.substring(0, 20) + '...');

    const clienteIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0').split(',')[0].trim();

    // Criar cliente
    const clienteResp = await fetch(`${API_URL}/v1/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        first_name: nome.split(' ')[0],
        last_name: nome.split(' ').slice(1).join(' ') || 'Portal',
        email,
        document_number: cpf.replace(/\D/g, ''),
        phone: telefone.replace(/\D/g, ''),
        ip: clienteIp,
        address: {
          postcode: cep.replace(/\D/g, ''),
          street: logradouro,
          number: numero || 'SN',
          district: bairro,
          city: cidade,
          state: estado
        }
      })
    });
    const clienteText = await clienteResp.text();
    console.log('Cliente:', clienteText);
    const cliente = JSON.parse(clienteText);
    const customer_id = cliente.id || (cliente.data && cliente.data.id);
    if (!customer_id) throw new Error('Cliente não criado: ' + clienteText);

    // Criar pedido
    const pedidoResp = await fetch(`${API_URL}/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        customer_id,
        products: [{ sku: 'ASSESSORIA-001', name: 'Assessoria Portal do Passaporte', price: 29687, qty: 1 }]
      })
    });
    const pedidoText = await pedidoResp.text();
    console.log('Pedido:', pedidoText);
    const pedido = JSON.parse(pedidoText);
    const cart_id = pedido.cart_id || (pedido.data && pedido.data.cart_id);
    if (!cart_id) throw new Error('Pedido não criado: ' + pedidoText);

    // Gerar boleto
    const boletoResp = await fetch(`${API_URL}/v1/payments/billet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ cart_id, days_due_date: 3 })
    });
    const boletoText = await boletoResp.text();
    console.log('Boleto:', boletoText);
    const boleto = JSON.parse(boletoText);

    res.json({
      success: true,
      linha_digitavel: boleto.billet_digitable_line || (boleto.data && boleto.data.billet_digitable_line) || 'Não disponível',
      url_pdf: boleto.billet_url || (boleto.data && boleto.data.billet_url) || '#'
    });

  } catch (err) {
    console.error('Erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
