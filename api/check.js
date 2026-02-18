export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { pin } = req.body;

        // Recupero variabili (qui potrebbe fallire se scritte male)
        const PIN_10 = process.env.PIN_10_EURO;

        if (pin === PIN_10) {
            return res.status(200).json({ success: true, amount: 10 });
        } else {
            return res.status(401).json({ success: false, message: "PIN Errato" });
        }

    } catch (err) {
        // QUESTO ti dirà finalmente cosa non va!
        return res.status(500).json({ 
            error: "ERRORE INTERNO DEL SERVER", 
            message: err.message, 
            stack: err.stack 
        });
    }
}
