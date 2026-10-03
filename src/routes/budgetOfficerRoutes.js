const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// GET /api/finance-officer/budget
router.get('/budget', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] || null;

        // 1. User Profile
        let userData = { fullName: 'Financial Officer', avatarSrc: '/customer/images/account.png' };
        if (userId) {
            const { data: userRec } = await supabase
                .from('users')
                .select('full_name, avatar')
                .eq('id', userId)
                .single();
            if (userRec) {
                userData = {
                    fullName: userRec.full_name,
                    avatarSrc: userRec.avatar || '/customer/images/account.png'
                };
            }
        }

        // 2. Fetch Budget Cycles
        const { data: cycles, error: cycleErr } = await supabase
            .from('budget_cycles')
            .select('*')
            .order('allocation_date', { ascending: false });

        if (cycleErr) throw cycleErr;

        const records = (cycles || []).map(c => ({
            id: c.id,
            date: c.allocation_date,
            cycle_name: c.cycle_name,
            capital: parseFloat(c.capital || 0),
            raw_material: parseFloat(c.raw_material || 0),
            petty_cash_fund: parseFloat(c.petty_cash_fund || 0),
            emergency_funds: parseFloat(c.emergency_funds || 0),
            manpower_cost: parseFloat(c.manpower_cost || 0),
            status: c.status
        }));

        return res.json({
            success: true,
            user: userData,
            records
        });
    } catch (err) {
        console.error('Error retrieving budget cycles:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/finance-officer/budget
router.post('/budget', async (req, res) => {
    try {
        const {
            cycle_name,
            allocation_date,
            capital,
            raw_material,
            petty_cash_fund,
            emergency_funds,
            manpower_cost
        } = req.body;

        const userId = req.headers['x-user-id'] || null;

        if (!cycle_name || !allocation_date || isNaN(capital) || isNaN(raw_material)) {
            return res.status(400).json({ status: 'error', message: 'Missing required budget parameters.' });
        }

        const { data, error } = await supabase
            .from('budget_cycles')
            .insert([{
                cycle_name,
                allocation_date,
                capital: parseFloat(capital),
                raw_material: parseFloat(raw_material),
                petty_cash_fund: parseFloat(petty_cash_fund || 0),
                emergency_funds: parseFloat(emergency_funds || 0),
                manpower_cost: parseFloat(manpower_cost || 0),
                status: 'ACTIVE',
                created_by: userId ? parseInt(userId, 10) : null
            }])
            .select()
            .single();

        if (error) throw error;

        // Log sa activity_logs
        await supabase.from('activity_logs').insert([{
            actor_id: userId ? parseInt(userId, 10) : null,
            actor_role: 'Finance Officer',
            action: 'ALLOCATE_BUDGET',
            category: 'FINANCE',
            description: `Allocated operating capital pool of ₱${parseFloat(capital).toFixed(2)} for cycle: ${cycle_name}`,
            target_type: 'budget_cycles',
            target_id: String(data.id)
        }]);

        return res.json({ status: 'success', record: data });
    } catch (err) {
        console.error('Error saving budget cycle:', err);
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET /api/finance-officer/expenses
router.get('/expenses', async (req, res) => {
    try {
        const { data: expList, error } = await supabase
            .from('expenses')
            .select(`
                id,
                item_name,
                store_name,
                amount,
                tier,
                status,
                category,
                notes,
                expense_date,
                created_at,
                requested_by,
                users:requested_by ( full_name )
            `)
            .order('expense_date', { ascending: false });

        if (error) throw error;

        const records = (expList || []).map(e => {
            const cost = parseFloat(e.amount || 0);

            // DOA Badge determination
            let doa_tier = 'procure';
            let doa_badge_text = 'Direct Buy (≤ ₱300)';
            if (e.tier === 'major' || cost > 500) {
                doa_tier = 'ceo';
                doa_badge_text = 'CEO Approved (> ₱500)';
            } else if (e.tier === 'medium' || cost > 300) {
                doa_tier = 'finance';
                doa_badge_text = 'Finance Endorsed (₱301–₱500)';
            }

            // Category display label
            let category_label = 'COGS (Materials)';
            if (e.category === 'direct') category_label = 'Petty Cash Direct Buy';
            else if (e.category === 'marketing') category_label = 'Marketing & Admin';
            else if (e.category === 'admin') category_label = 'Admin & Utilities';

            return {
                id: e.id,
                voucher_num: `MM-VOUCH-${String(e.id).padStart(4, '0')}`,
                particulars: e.item_name,
                category: e.category || 'cogs',
                category_label,
                cycle_date: e.expense_date,
                vendor_name: e.store_name || 'Counter Sourcing',
                or_number: e.notes ? e.notes.replace(/^OR#:\s*/i, '') : `OR-${e.id}`,
                amount: cost,
                status: e.status,
                doa_tier,
                doa_badge_text
            };
        });

        return res.json({ success: true, records });
    } catch (err) {
        console.error('Error retrieving expenses:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/finance-officer/expenses
router.post('/expenses', async (req, res) => {
    try {
        const { particulars, category, date, vendor_name, or_number, amount } = req.body;
        const userId = req.headers['x-user-id'] || null;

        if (!particulars || !vendor_name || !or_number || isNaN(amount) || parseFloat(amount) <= 0) {
            return res.status(400).json({ status: 'error', message: 'Incomplete disbursement details.' });
        }

        const cost = parseFloat(amount);
        let tier = 'micro';
        let status = 'PURCHASED'; // Dahil may physical receipt / OR na, nabili na ito

        if (cost > 500) {
            tier = 'major';
        } else if (cost > 300) {
            tier = 'medium';
        }

        const { data, error } = await supabase
            .from('expenses')
            .insert([{
                item_name: particulars,
                store_name: vendor_name,
                amount: cost,
                tier: tier,
                status: status,
                category: category || 'cogs',
                notes: `OR#: ${or_number}`,
                expense_date: date || new Date().toISOString().split('T')[0],
                requested_by: userId ? parseInt(userId, 10) : 1,
                finance_approved_by: userId ? parseInt(userId, 10) : null
            }])
            .select()
            .single();

        if (error) throw error;

        // Log sa activity_logs
        await supabase.from('activity_logs').insert([{
            actor_id: userId ? parseInt(userId, 10) : null,
            actor_role: 'Finance Officer',
            action: 'RECORD_DISBURSEMENT',
            category: 'FINANCE',
            description: `Posted disbursement voucher for "${particulars}" (₱${cost.toFixed(2)}) with OR# ${or_number}`,
            target_type: 'expenses',
            target_id: String(data.id)
        }]);

        return res.json({ status: 'success', record: data });
    } catch (err) {
        console.error('Error logging disbursement voucher:', err);
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

module.exports = router;