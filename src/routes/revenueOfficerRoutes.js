const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// GET /api/finance-officer/revenue
router.get('/revenue', async (req, res) => {
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

        // 2. Baseline Launch / Cycle Date mula sa budget_cycles o store_settings
        let cycleStartDate = '2026-10-08'; // Default Master SOP Section 7.B benchmark
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

        // 3. Orders & Completed Sales Inflows
        const { data: orders, error: ordersErr } = await supabase
            .from('orders')
            .select('id, order_number, order_type, total_amount, payment_method, status, placed_at')
            .eq('status', 'COMPLETED');

        if (ordersErr) throw ordersErr;

        let totalRevenue = 0;
        let preordersInflow = 0; // E-Wallets / Online Custom builds
        let presetsInflow = 0;   // Cash / Counter Presets

        (orders || []).forEach(o => {
            const amt = parseFloat(o.total_amount || 0);
            totalRevenue += amt;
            const payMethod = (o.payment_method || '').toLowerCase();
            if (payMethod.includes('cash')) {
                presetsInflow += amt;
            } else {
                preordersInflow += amt;
            }
        });

        // 4. Flavor Sales & Unit Margins mula sa order_items
        const { data: items, error: itemsErr } = await supabase
            .from('order_items')
            .select(`
                id,
                item_label,
                size,
                quantity,
                unit_price,
                line_total,
                orders!inner ( status )
            `)
            .eq('orders.status', 'COMPLETED');

        if (itemsErr) throw itemsErr;

        // Group by item_label at compute margins
        const flavorMap = {};
        (items || []).forEach(row => {
            const label = row.item_label || 'Specialty Drink';
            const qty = parseInt(row.quantity || 1, 10);
            const lineTotal = parseFloat(row.line_total || (qty * parseFloat(row.unit_price || 0)));

            if (!flavorMap[label]) {
                const isSpecialty = label.toLowerCase().includes('latte') || label.toLowerCase().includes('coffee');
                flavorMap[label] = {
                    flavor_name: label,
                    category: isSpecialty ? 'specialty' : 'pearl',
                    category_label: isSpecialty ? 'Specialty / Lattes' : 'Pearl Milk Tea',
                    cups_sold: 0,
                    unit_price: parseFloat(row.unit_price || 0),
                    gross_sales: 0,
                    unit_cogs: isSpecialty ? 14.50 : 12.00
                };
            }
            flavorMap[label].cups_sold += qty;
            flavorMap[label].gross_sales += lineTotal;
        });

        const flavorContributions = Object.values(flavorMap).map(f => {
            const totalCogs = f.unit_cogs * f.cups_sold;
            const netProfit = f.gross_sales - totalCogs;
            const netMarginPct = f.gross_sales > 0 ? Math.round((netProfit / f.gross_sales) * 100) : 0;
            return {
                ...f,
                net_margin_pct: netMarginPct,
                perf_status: netMarginPct >= 42 ? 'High Margin' : 'Standard Yield'
            };
        });

        // 5. Total Expenses para sa Average Net Margin per Cup
        const { data: expenses } = await supabase
            .from('expenses')
            .select('amount')
            .in('status', ['APPROVED', 'PURCHASED']);

        const totalExpenses = (expenses || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
        const totalCups = flavorContributions.reduce((s, f) => s + f.cups_sold, 0);
        const netProfit = totalRevenue - totalExpenses;
        const avgCupMargin = totalCups > 0 ? (netProfit / totalCups) : null;
        const netProfitMarginPct = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0';

        // 6. Weekly Tuesday vs Thursday Cash Flow Breakdown
        let tueRev = 0;
        let thuRev = 0;
        (orders || []).forEach(o => {
            const date = new Date(o.placed_at);
            const day = date.getDay(); // 2 = Tuesday, 4 = Thursday
            const amt = parseFloat(o.total_amount || 0);
            if (day === 2) tueRev += amt;
            else if (day === 4) thuRev += amt;
        });

        return res.json({
            success: true,
            user: userData,
            cycleStartDate,
            metrics: {
                totalRevenue,
                preordersInflow,
                presetsInflow,
                avgCupMargin,
                netProfitMarginPct
            },
            flavorContributions,
            weeklyComparison: {
                tuesday: [tueRev * 0.2, tueRev * 0.3, tueRev * 0.4, tueRev],
                thursday: [thuRev * 0.2, thuRev * 0.3, thuRev * 0.4, thuRev]
            },
            channelShares: [preordersInflow, presetsInflow]
        });

    } catch (err) {
        console.error('Error fetching revenue dashboard data:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/finance-officer/payments
router.get('/payments', async (req, res) => {
    try {
        const { data: payments, error } = await supabase
            .from('payments')
            .select(`
                id,
                order_id,
                provider,
                provider_reference,
                amount,
                status,
                paid_at,
                created_at,
                orders (
                    order_number,
                    payment_method,
                    guest_name,
                    customers (
                        users ( full_name )
                    )
                )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const formatted = (payments || []).map(p => {
            const customerName = p.orders?.customers?.users?.full_name || p.orders?.guest_name || 'Walk-in Guest';
            const method = (p.orders?.payment_method || p.provider || '').toLowerCase();
            const isCash = method.includes('cash');

            return {
                id: p.id,
                date: new Date(p.paid_at || p.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                }),
                customer_name: customerName,
                order_number: p.orders?.order_number || `MM-${p.order_id}`,
                channel: isCash ? 'cash' : 'ewallet',
                channel_label: isCash ? 'Counter Cash' : (p.provider || 'E-Wallet'),
                ref_id: p.provider_reference || `TXN-${p.id}`,
                amount: parseFloat(p.amount || 0),
                status: p.status
            };
        });

        return res.json({ success: true, payments: formatted });
    } catch (err) {
        console.error('Error fetching payments ledger:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/finance-officer/reconciliation/preview
router.get('/reconciliation/preview', async (req, res) => {
    try {
        const openingFloat = 1000.00; // Baseline Float ayon sa Master SOP Section 7.A

        // Kunin ang walk-in cash sales simula sa huling reconciliation
        const { data: lastReconcile } = await supabase
            .from('drawer_reconciliations')
            .select('period_end')
            .order('period_end', { ascending: false })
            .limit(1)
            .maybeSingle();

        const periodStart = lastReconcile?.period_end || new Date(new Date().setHours(0,0,0,0)).toISOString();

        const { data: cashOrders } = await supabase
            .from('orders')
            .select('total_amount')
            .eq('status', 'COMPLETED')
            .ilike('payment_method', '%cash%')
            .gte('placed_at', periodStart);

        const walkinCashTotal = (cashOrders || []).reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
        const expectedDrawer = openingFloat + walkinCashTotal;

        return res.json({
            openingFloat,
            walkinCashTotal,
            expectedDrawer,
            periodStart
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

// POST /api/finance-officer/reconciliation
router.post('/reconciliation', async (req, res) => {
    try {
        const { counted_amount, notes } = req.body;
        const actorId = req.headers['x-user-id'] || null;

        const openingFloat = 1000.00;

        const { data: lastReconcile } = await supabase
            .from('drawer_reconciliations')
            .select('period_end')
            .order('period_end', { ascending: false })
            .limit(1)
            .maybeSingle();

        const periodStart = lastReconcile?.period_end || new Date(new Date().setHours(0,0,0,0)).toISOString();
        const periodEnd = new Date().toISOString();

        const { data: cashOrders } = await supabase
            .from('orders')
            .select('total_amount')
            .eq('status', 'COMPLETED')
            .ilike('payment_method', '%cash%')
            .gte('placed_at', periodStart);

        const walkinCashTotal = (cashOrders || []).reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
        const expected_amount = openingFloat + walkinCashTotal;
        const variance = parseFloat(counted_amount) - expected_amount;

        const { data, error } = await supabase
            .from('drawer_reconciliations')
            .insert([{
                counted_amount: parseFloat(counted_amount),
                expected_amount,
                variance,
                period_start: periodStart,
                period_end: periodEnd,
                notes: notes || 'Settled and Reconciled by Financial Officer',
                recorded_by: actorId
            }])
            .select()
            .single();

        if (error) throw error;

        // I-log sa activity_logs
        await supabase.from('activity_logs').insert([{
            actor_id: actorId,
            actor_role: 'Finance Officer',
            action: 'RECONCILE_DRAWER',
            category: 'FINANCE',
            description: `Cash register cleared. Expected: ₱${expected_amount.toFixed(2)}, Counted: ₱${parseFloat(counted_amount).toFixed(2)}, Variance: ₱${variance.toFixed(2)}`,
            target_type: 'drawer_reconciliations',
            target_id: String(data.id)
        }]);

        return res.json({ status: 'success', record: data });
    } catch (err) {
        console.error('Error recording drawer reconciliation:', err);
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// POST /api/finance-officer/cycle-start
router.post('/cycle-start', async (req, res) => {
    try {
        const { start_date } = req.body;
        if (!start_date) {
            return res.status(400).json({ success: false, message: 'Start date is required' });
        }

        const { data, error } = await supabase
            .from('store_settings')
            .upsert({
                key: 'dso_cycle_start_date',
                value: start_date,
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' })
            .select()
            .single();

        if (error) throw error;

        return res.json({ success: true, message: 'DSO cycle baseline date updated.', data });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;