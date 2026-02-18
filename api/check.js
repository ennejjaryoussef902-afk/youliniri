export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const pinRicevuto = req.body?.pin?.toString().trim();
    const pinAtteso = process.env.CODE_5_EURO?.toString().trim();

    console.log("--- TEST COMPARAZIONE ---");
    console.log("Ricevuto dal sito: [" + pinRicevuto + "]");
    console.log("Atteso da Vercel: [" + pinAtteso + "]");
    
    if (!pinAtteso) {
        console.error("ERRORE: La variabile CODE_5_EURO non è configurata su Vercel!");
    }

    if (pinRicevuto === pinAtteso && pinAtteso !== undefined) {
        console.log("RISULTATO: Corrispondenza trovata!");
        return res.status(200).json({ success: true, amount: 5 });
    } else {
        console.log("RISULTATO: PIN Sbagliato o Variabile mancante.");
        return res.status(401).json({ success: false });
    }
}
