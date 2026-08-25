const http = require('http');

const data = JSON.stringify({
  email: 'rose.fo@thenearbuy.com',
  password: 'Password123!'
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/sign-in',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response Body:', body);
  });
});

req.on('error', (e) => {
  console.error('Request Error:', e);
});

req.write(data);
req.end();
