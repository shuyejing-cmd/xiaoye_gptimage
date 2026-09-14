import nodemailer from "nodemailer";

export function createSmtpMailer(config, transport = nodemailer.createTransport(config)) {
  return {
    async sendLoginCode({ email, code }) {
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: "WorkBuddy 登录验证码",
        text: `你的 WorkBuddy 登录验证码是：${code}\n\n验证码 10 分钟内有效，请勿转发。`
      });
    },
    async sendManualReview({ email, requestIds }) {
      if (!requestIds.length) return;
      await transport.sendMail({ from: config.from, to: email, subject: "WorkBuddy 生成任务需要人工复核", text: `以下任务超过 24 小时仍无法确认结果：\n${requestIds.join("\n")}` });
    }
  };
}
