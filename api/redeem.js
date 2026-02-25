import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
    const { username, token } = req.body;

    // Qui leggiamo i codici dalle variabili d'ambiente di Vercel
    const codiciSegreti = {
        [process.env.TOKEN_10]: 10,
        [process.env.TOKEN_5_A]: 5,
        [process.env.TOKEN_5_B]: 5
    };

    if (token && codiciSegreti[token]) {
        const premio = codiciSegreti[token];
        const { data } = await supabase.from('users').select('balance').eq('username', username).single();
        const nuovoSaldo = (data?.balance || 0) + premio;

        await supabase.from('users').update({ balance: nuovoSaldo }).eq('username', username);
        return res.status(200).json({ success: true, nuovoSaldo });
    }
    return res.status(400).json({ success: false });
}