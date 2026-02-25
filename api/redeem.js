const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ msg: "Metodo non ammesso" });

    const { username, token } = req.body;

    const codiciSegreti = {
        [process.env.TOKEN_10]: 10,
        [process.env.TOKEN_5_A]: 5,
        [process.env.TOKEN_5_B]: 5
    };

    try {
        if (token && codiciSegreti[token]) {
            const premio = codiciSegreti[token];

            // Recupera saldo attuale
            const { data: user } = await supabase
                .from('users')
                .select('balance')
                .eq('username', username)
                .single();

            const nuovoSaldo = (user?.balance || 0) + premio;

            // Aggiorna saldo
            const { error: upError } = await supabase
                .from('users')
                .update({ balance: nuovoSaldo })
                .eq('username', username);

            if (upError) throw upError;

            return res.status(200).json({ success: true, nuovoSaldo, premio });
        }
        
        return res.status(400).json({ success: false, msg: "Codice non valido" });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, msg: "Errore riscatto" });
    }
};