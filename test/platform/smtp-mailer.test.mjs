import test from "node:test";
import assert from "node:assert/strict";
import * as smtpMailer from "../../src/platform/mail/smtp-mailer.mjs";

test("SMTP credentials are passed through Nodemailer's auth object", () => {
  assert.equal(typeof smtpMailer.createSmtpTransportConfig, "function");
  assert.deepEqual(smtpMailer.createSmtpTransportConfig({
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    user: "sender@example.test",
    pass: "authorization-code",
    from: "sender@example.test"
  }), {
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    auth: { user: "sender@example.test", pass: "authorization-code" }
  });
});
