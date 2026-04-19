export default async function handler(req, res) {
  // 1. حماية الـ API (CORS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method not allowed" });

  try {
    const { email, name, orderId, status } = req.body;

    if (!email || !orderId || !status) {
      return res.status(400).json({ ok: false, message: "Missing required fields" });
    }

    // 2. تحديد محتوى الإيميل بناءً على حالة الطلب
    let subject = "";
    let title = "";
    let message = "";
    let color = "";

    if (status === "accepted") {
      subject = `تم تأكيد طلبك بنجاح! 🎉 - مكتبة دير شرف`;
      title = "تم تأكيد الطلب";
      message = `مرحباً ${name}،<br><br>شكراً لتسوقك من مكتبة دير شرف العلمية. تم استلام طلبك رقم <strong>#${orderId}</strong> بنجاح وجاري تجهيزه حالياً بكل حب. 📦`;
      color = "#0ea5e9"; // لون أزرق (Sky)
    } else if (status === "shipped") {
      subject = `طلبك في الطريق إليك! 🚚 - مكتبة دير شرف`;
      title = "الطلب قيد الشحن";
      message = `مرحباً ${name}،<br><br>خبر سعيد! طلبك رقم <strong>#${orderId}</strong> تم تسليمه لشركة التوصيل وهو الآن في طريقه إليك. سيتواصل معك المندوب قريباً للتسليم. 🚀`;
      color = "#10b981"; // لون أخضر (Emerald)
    } else {
      return res.status(200).json({ ok: true, message: "No email needed for this status" });
    }

    // 3. قالب الإيميل (HTML فخم واحترافي)
    const htmlContent = `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="background-color: ${color}; padding: 30px 20px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">${title}</h1>
        </div>
        <div style="padding: 30px 20px; background-color: #ffffff; color: #334155; line-height: 1.6; font-size: 16px;">
          <p>${message}</p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="https://dairsharaf.com/tracking?orderId=${orderId}" style="background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">تتبع حالة الطلب</a>
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0;">
          <p style="margin: 0;">مكتبة دير شرف العلمية - خيارك الأول للألعاب التعليمية والقرطاسية</p>
        </div>
      </div>
    `;

    // 4. إرسال الإيميل عبر SendGrid API
    // تأكد إنك ضايف SENDGRID_API_KEY في ملف .env تبعك
    const sendgridResponse = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: email }] }],
        from: { email: "info@dairsharaf.com", name: "مكتبة دير شرف العلمية" }, // حط إيميلك الرسمي هون
        subject: subject,
        content: [{ type: "text/html", value: htmlContent }]
      })
    });

    if (!sendgridResponse.ok) {
      const errorText = await sendgridResponse.text();
      console.error("SendGrid Error:", errorText);
      throw new Error("Failed to send email via SendGrid");
    }

    return res.status(200).json({ ok: true, message: "Customer notified successfully" });

  } catch (error) {
    console.error("Notify Customer Error:", error);
    return res.status(500).json({ ok: false, message: "Internal server error" });
  }
}