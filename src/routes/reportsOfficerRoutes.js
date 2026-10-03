const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// GET /api/finance-officer/reports
router.get('/reports', async (req, res) => {
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

        // 2. Baseline Launch / Cycle Date (Master SOP Benchmark: 2026-10-08)
        let cycleStartDate = '2026-10-08';
        const { data: activeBudget } = await supabase
            .from('budget_cycles')
            .select('allocation_date')
            .eq('status', 'ACTIVE')
            .order('allocation_date', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (activeBudget && activeBudget.allocation_date) {
            cycleStartDate = activeBudget.allocation_date;
        } else {
            const { data: settingDate } = await supabase
                .from('store_settings')
                .select('value')
                .eq('key', 'dso_cycle_start_date')
                .maybeSingle();
            if (settingDate && settingDate.value) {
                cycleStartDate = settingDate.value;
            }
        }

        // 3. Completed Orders Revenue
        const { data: orders, error: ordersErr } = await supabase
            .from('orders')
            .select('total_amount, payment_method, status')
            .eq('status', 'COMPLETED');

        if (ordersErr) throw ordersErr;

        let grossRevenue = 0;
        let preorderSales = 0;
        let presetSales = 0;

        (orders || []).forEach(o => {
            const amt = parseFloat(o.total_amount || 0);
            grossRevenue += amt;
            const payMethod = (o.payment_method || '').toLowerCase();
            if (payMethod.includes('cash')) {
                presetSales += amt;
            } else {
                preorderSales += amt;
            }
        });

        // 4. Approved & Purchased Expenses Breakdown
        const { data: expenses, error: expErr } = await supabase
            .from('expenses')
            .select('amount, category, tier, status')
            .in('status', ['APPROVED', 'PURCHASED']);

        if (expErr) throw expErr;

        let ingredientsCost = 0;
        let packagingCost = 0;
        let directBuysExp = 0;
        let overheadExp = 0;
        let marketingExp = 0;

        (expenses || []).forEach(e => {
            const amt = parseFloat(e.amount || 0);
            const cat = (e.category || '').toLowerCase();
            const tier = (e.tier || '').toLowerCase();

            if (cat === 'cogs') {
                ingredientsCost += amt * 0.75;
                packagingCost += amt * 0.25;
            } else if (cat === 'direct' || tier === 'micro' || amt <= 300) {
                directBuysExp += amt;
            } else if (cat === 'marketing') {
                marketingExp += amt;
            } else {
                overheadExp += amt;
            }
        });

        const cogsRaw = ingredientsCost + packagingCost;
        const totalDisbursements = directBuysExp + overheadExp + marketingExp;
        const totalExpenses = cogsRaw + totalDisbursements;
        const grossProfit = grossRevenue - cogsRaw;
        const netIncome = grossRevenue - totalExpenses;
        const netProfitMarginPct = grossRevenue > 0 ? ((netIncome / grossRevenue) * 100).toFixed(1) : '0.0';

        // 5. Latest Drawer Reconciliation
        const { data: latestReconciliation } = await supabase
            .from('drawer_reconciliations')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        return res.json({
            success: true,
            user: userData,
            cycleStartDate,
            financialData: {
                grossRevenue,
                preorderSales,
                presetSales,
                cogsRaw,
                ingredientsCost,
                packagingCost,
                grossProfit,
                directBuysExp,
                overheadExp,
                marketingExp,
                totalDisbursements,
                netIncome,
                netProfitMarginPct,
                latestReconciliation
            }
        });

    } catch (err) {
        console.error('Error generating financial reports data:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;