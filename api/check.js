export default async function handler(req, res) {
    // --- 1. CONFIGURAZIONE CORS (Permessi di accesso) ---
    // Questo permette a qualsiasi dominio (anche locale) di interrogare la tua API
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Gestione della richiesta "pre-volo" (OPTIONS) del browser
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // --- 2. LOGICA DI VERIFICA ---
    if (req.method === 'POST') {
        const { pin } = req.body;

        // Recupera i codici dalle Environment Variables di Vercel
        // Assicurati di averle create nella dashboard di Vercel (Settings > Environment Variables)
        const code5 = process.env.CODE_5_EURO; 
        const code10 = process.env.CODE_10_EURO; 

        if (!pin) {
            return res.status(400).json({ success: false, message: "PIN mancante" });
        }

        // Controllo corrispondenza
        if (pin === code5) {
            return res.status(200).json({ 
                success: true, 
                amount: 5.00,
                message: "Riscatto da 5 Euro effettuato" 
            });
        } 
        else if (pin === code10) {
            return res.status(200).json({ 
                success: true, 
                amount: 10.00,
                message: "Riscatto da 10 Euro effettuato" 
            });
        } 
        else {
            // Se il PIN non corrisponde a nessuno dei due
            return res.status(401).json({ 
                success: false, 
                message: "Codice non valido" 
            });
        }
    }

    // Se qualcuno prova ad accedere con un metodo diverso da POST (es. GET)
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ message: `Metodo ${req.method} non consentito` });
}
