import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
    const { username, password } = req.body;
    
    // Prova a loggare
    let { data, error } = await supabase.from('users').select('*').eq('username', username).eq('password', password).single();
    
    if (data) return res.status(200).json(data);

    // Se non esiste, lo registra automaticamente
    const { data: newUser, error: regError } = await supabase.from('users').insert([{ username, password, balance: 0 }]).select().single();
    
    if (regError) return res.status(400).json({ msg: "Errore accesso" });
    return res.status(200).json(newUser);
}