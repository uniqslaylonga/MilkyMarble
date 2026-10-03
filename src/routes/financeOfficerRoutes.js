const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Siguraduhing may SUPABASE_URL at SUPABASE_SERVICE_ROLE_KEY sa inyong .env
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// GET /api/finance-officer/dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] || req.user?.id;

        // 1. Kunin ang user details kung may userId
        let userData = { fullName: 'Finance Officer', firstName: 'Finance', avatarSrc: '/customer/images/account.png' };
        if (userId) {
            const { data: userRecord } = await supabase
                .from('users')
                .select('id, full_name, avatar')
                .eq('id', userId)
                .single();

            if (userRecord) {
                const nameParts = (userRecord.full_name || 'Finance Officer').split(' ');
                userData = {
                    fullName: userRecord.full_name,
                    firstName: nameParts[0] || 'Finance',
                    avatarSrc: userRecord.avatar || '/customer/images/account.png'
                };
            }
        }

        // 2. Compute Total Revenue (Mula sa completed orders)
        const { data: revenueData, error: revError } = await supabase
            .from('orders')
            .select('total_amount')
            .eq('status', 'COMPLETED');

        const totalRevenue = (revenueData || []).reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);

        // 3. Compute Total Expenses (Mula sa purchased / approved expenses)
        const { data: expenseData, error: expError } = await supabase
            .from('expenses')
            .select('amount, status, category')
            .in('status', ['APPROVED', 'PURCHASED']);

        const totalExpenses = (expenseData || []).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

        // 4. Kunin ang Middle-Tier Pre-Approvals (₱301–₱500 at PENDING_FINANCE)
        const { data: pendingMediumList, error: medError } = await supabase
            .from('expenses')
            .select(`
                id,
                item_name,
                store_name,
                amount,
                tier,
                status,
                requested_by,
                notes,
                expense_date,
                created_at,
                users:requested_by (full_name)
            `)
            .eq('tier', 'medium')
            .eq('status', 'PENDING_FINANCE')
            .order('created_at', { ascending: false });

        if (medError) throw medError;

        // I-format para sa Pre-Approval desk
        const preApprovals = (pendingMediumList || []).map(item => ({
            id: item.id,
            pr_code: `PR-${String(item.id).padStart(4, '0')}`,
            item_name: item.item_name,
            vendor: item.store_name || 'Vendor / Market',
            department: 'Procurement',
            total_cost: parseFloat(item.amount || 0),
            requested_by_name: item.users?.full_name || 'Procurement Officer',
            notes: item.notes || '',
            date: item.expense_date
        }));

        // 5. Kunin ang Direct Buy Liquidations (≤ ₱300 na na-PURCHASED na ni Procurement at kailangan i-audit)
        const { data: directBuysList, error: directError } = await supabase
            .from('expenses')
            .select(`
                id,
                item_name,
                store_name,
                amount,
                tier,
                status,
                requested_by,
                receipt_image,
                notes,
                created_at
            `)
            .eq('tier', 'micro')
            .eq('status', 'PURCHASED')
            .order('created_at', { ascending: false });

        if (directError) throw directError;

        const liquidations = (directBuysList || []).map(item => ({
            id: item.id,
            pr_code: `DIR-${String(item.id).padStart(4, '0')}`,
            item_name: item.item_name,
            or_number: item.notes ? item.notes.substring(0, 25) : 'OR / Receipt Stamped',
            total_cost: parseFloat(item.amount || 0),
            receipt_image: item.receipt_image
        }));

        // 6. Simplified Cash Flow at COGS breakdowns para sa charts
        const releaseCashFlow = {
            revenue: [totalRevenue * 0.55, totalRevenue * 0.45],
            outflow: [totalExpenses * 0.6, totalExpenses * 0.4]
        };

        return res.json({
            success: true,
            user: userData,
            metrics: {
                totalRevenue,
                totalExpenses
            },
            preApprovals,
            liquidations,
            releaseCashFlow,
            cogsBreakdown: [45, 30, 25]
        });
    } catch (err) {
        console.error('Error fetching finance dashboard:', err);
        return res.status(500).json({ success: false, message: err.message || 'Database error occurred' });
    }
});

// PATCH /api/finance-officer/expenses/:id/approve
// Tandaan: Ina-approve ito ng Finance para magkaroon ng go-signal si Procurement na bilhin
router.patch('/expenses/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const approverId = req.headers['x-user-id'] || req.body.approver_id || null;

        const { data, error } = await supabase
            .from('expenses')
            .update({
                status: 'APPROVED',
                finance_approved_by: approverId
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Mag-log sa activity_logs
        await supabase.from('activity_logs').insert([{
            actor_id: approverId,
            actor_role: 'Finance Officer',
            action: 'APPROVE_EXPENSE',
            category: 'FINANCE',
            description: `Finance Officer cleared requisition PR-${String(id).padStart(4, '0')} for ${data.item_name}. Procurement authorized to purchase.`,
            target_type: 'expenses',
            target_id: String(id)
        }]);

        return res.json({
            success: true,
            message: 'Requisition approved. Procurement is now authorized to execute purchase.',
            data
        });
    } catch (err) {
        console.error('Error approving expense:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// PATCH /api/finance-officer/expenses/:id/reject
router.patch('/expenses/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const actorId = req.headers['x-user-id'] || req.body.actor_id || null;

        const { data, error } = await supabase
            .from('expenses')
            .update({
                status: 'REJECTED',
                notes: reason ? `Rejected by Finance: ${reason}` : 'Rejected by Finance'
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        await supabase.from('activity_logs').insert([{
            actor_id: actorId,
            actor_role: 'Finance Officer',
            action: 'REJECT_EXPENSE',
            category: 'FINANCE',
            description: `Finance rejected PR-${String(id).padStart(4, '0')}. Reason: ${reason || 'N/A'}`,
            target_type: 'expenses',
            target_id: String(id)
        }]);

        return res.json({ success: true, message: 'Requisition successfully rejected.', data });
    } catch (err) {
        console.error('Error rejecting expense:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/finance-officer/expenses/voucher
router.post('/expenses/voucher', async (req, res) => {
    try {
        const { description, category, amount, or_number } = req.body;
        const userId = req.headers['x-user-id'] || req.body.requested_by || 1;

        if (!description || !amount) {
            return res.status(400).json({ success: false, message: 'Description and amount are required.' });
        }

        const numericAmount = parseFloat(amount);
        let tier = 'micro';
        if (numericAmount > 500) tier = 'major';
        else if (numericAmount > 300) tier = 'medium';

        const { data, error } = await supabase
            .from('expenses')
            .insert([{
                item_name: description,
                category: category || 'cogs',
                amount: numericAmount,
                tier: tier,
                status: 'PURCHASED',
                requested_by: userId,
                finance_approved_by: userId,
                expense_date: new Date().toISOString().split('T')[0],
                notes: or_number ? `OR#: ${or_number}` : null
            }])
            .select()
            .single();

        if (error) throw error;

        return res.json({ success: true, message: 'Disbursement voucher posted successfully.', data });
    } catch (err) {
        console.error('Error creating disbursement voucher:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// PATCH /api/finance-officer/expenses/:id/liquidate
router.patch('/expenses/:id/liquidate', async (req, res) => {
    try {
        const { id } = req.params;
        const actorId = req.headers['x-user-id'] || null;

        const { data, error } = await supabase
            .from('expenses')
            .update({
                finance_approved_by: actorId
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return res.json({ success: true, message: 'Disbursement audited and petty cash replenished.', data });
    } catch (err) {
        console.error('Error liquidating expense:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;