export default function handler(req, res) {
    // Gestione CORS per evitare blocchi
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Metodo non consentito' });

    const { pin } = req.body;

    // Qui elenchiamo i PIN prendendoli dalle variabili di Vercel
    const PIN_10 = process.env.PIN_10_EURO; // Esempio: 43510Npy462A598317d
    const PIN_5 = process.env.PIN_5_EURO;   // Esempio: 12345

    if (pin === PIN_10) {
        return res.status(200).json({ success: true, amount: 10 });
    } else if (pin === PIN_5) {
        return res.status(200).json({ success: true, amount: 5 });
    } else {
        // Se il PIN non corrisponde a nessuno dei due, diamo 401
        return res.status(401).json({ success: false, message: 'PIN non valido' });
    }
}
