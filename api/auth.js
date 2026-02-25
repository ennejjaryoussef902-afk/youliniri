const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res) => {
    // Gestione CORS per evitare blocchi
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { username, password } = req.body;
    
    try {
        // Prova a cercare l'utente
        let { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .single();
        
        if (data) return res.status(200).json(data);

        // Se non esiste, lo registra
        const { data: newUser, error: regError } = await supabase
            .from('users')
            .insert([{ username, password, balance: 0 }])
            .select()
            .single();
        
        if (regError) return res.status(400).json({ msg: "Errore database o utente esistente" });
        return res.status(200).json(newUser);
    } catch (err) {
        return res.status(500).json({ msg: "Errore interno del server" });
    }
};