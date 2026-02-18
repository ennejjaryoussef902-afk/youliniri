export default function handler(req, res) {
    const { pin } = req.body;
    
    // Prendiamo sia il PIN che il PREMIO dalle variabili d'ambiente
    const secretPin = process.env.MY_SECRET_PIN;
    const premioSegreto = process.env.GIFT_CARD_CODE;

    if (pin === secretPin) {
        return res.status(200).json({ success: true, code: premioSegreto });
    } else {
        return res.status(401).json({ success: false, message: "PIN Errato" });
    }
}