const nodemailer = require('nodemailer');
 const path = require('path');
 require('dotenv').config({ path: path.join(__dirname, '.env') });
 
 console.log('Host:', process.env.MAILER_SMTP_HOST);
 console.log('User:', process.env.MAILER_SMTP_USER);
 console.log('Password length:', (process.env.MAILER_SMTP_PASSWORD ?? '').length);
 console.log('Password starts with:', (process.env.MAILER_SMTP_PASSWORD ?? '').substring(0, 12));
 
 const t = nodemailer.createTransport({
   host: process.env.MAILER_SMTP_HOST,
   port: Number(process.env.MAILER_SMTP_PORT),
   secure: process.env.MAILER_SMTP_SECURE === 'true',
   auth: { user: process.env.MAILER_SMTP_USER, pass: process.env.MAILER_SMTP_PASSWORD },
 });
 
 t.sendMail({
   from: process.env.MAILER_FROM,
   to: 'seu-email-pessoal@gmail.com',
   subject: 'Teste IntelliQuote + Brevo',
   text: 'Se voce leu isso, ta funcionando!',
 }).then(() => console.log('OK')).catch((e) => console.error('FALHOU:', e.message));