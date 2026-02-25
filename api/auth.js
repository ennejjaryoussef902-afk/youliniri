const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
    // 1. Controllo Variabili d'ambiente
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        return res.status(500).json({ msg: "Mancano le chiavi su Vercel!" });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    if (req.method !== 'POST') return res.status(405).end();

    const { username, password } = req.body;

    try {
        // Cerca utente
        let { data: user, error: searchError } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();

        if (user) {
            if (user.password === password) return res.status(200).json(user);
            return res.status(401).json({ msg: "Password errata" });
        }

        // Registrazione
        const { data: newUser, error: regError } = await supabase
            .from('users')
            .insert([{ username, password, balance: 0 }])
            .select()
            .single();

        if (regError) return res.status(400).json({ msg: "Errore registrazione: " + regError.message });
        
        return res.status(200).json(newUser);

    } catch (err) {
        return res.status(500).json({ msg: "Errore fatale: " + err.message });
    }
};