import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function getSalesOfficerDashboard(req, res) {
    try {
        const userId = req.headers['x-user-id'];

        // 1. Employee User Details
        let user = { fullName: 'Sales Officer', firstName: 'Officer', avatarSrc: '/customer/images/account.png' };
        if (userId) {
            const { data: emp } = await supabase
                .from('employees')
                .select('full_name, avatar')
                .eq('user_id', userId)
                .single();

            if (emp) {
                user.fullName = emp.full_name;
                user.firstName = emp.full_name.split(' ')[0];
                if (emp.avatar) user.avatarSrc = emp.avatar;
            }
        }

        // Setup Date Boundaries (UTC / Philippine Time)
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        const startOfWeek = weekAgo.toISOString();

        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const threeMonthsAgo = new Date(now);
        threeMonthsAgo.setDate(now.getDate() - 90);
        const startOf3Months = threeMonthsAgo.toISOString();

        // 2. Operational Metrics (Today's Orders, Revenue, Pending)
        const { data: todayOrdersData } = await supabase
            .from('orders')
            .select('id, total_amount, status')
            .gte('placed_at', startOfToday);

        const todayOrders = todayOrdersData ? todayOrdersData.length : 0;
        const todaySales = todayOrdersData
            ? todayOrdersData
                .filter(o => o.status !== 'CANCELLED')
                .reduce((sum, o) => sum + Number(o.total_amount || 0), 0)
            : 0;

        const { count: pendingCount } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .in('status', ['PENDING_PAYMENT', 'PENDING']);

        // 3. Customer Acquisition (New Accounts Count from 'customers' table)
        const [todayAcq, weekAcq, monthAcq, threeMonthAcq] = await Promise.all([
            supabase.from('customers').select('*', { count: 'exact', head: true }).gte('created_at', startOfToday),
            supabase.from('customers').select('*', { count: 'exact', head: true }).gte('created_at', startOfWeek),
            supabase.from('customers').select('*', { count: 'exact', head: true }).gte('created_at', startOfMonth),
            supabase.from('customers').select('*', { count: 'exact', head: true }).gte('created_at', startOf3Months)
        ]);

        // 4. Guest vs. Registered Revenue Ratio (All non-cancelled orders)
        const { data: allSales } = await supabase
            .from('orders')
            .select('customer_id, total_amount, status')
            .neq('status', 'CANCELLED');

        let registeredRevenue = 0;
        let guestRevenue = 0;

        (allSales || []).forEach(ord => {
            const amount = Number(ord.total_amount || 0);
            if (ord.customer_id) {
                registeredRevenue += amount;
            } else {
                guestRevenue += amount;
            }
        });

        const totalSplit = registeredRevenue + guestRevenue;
        const registeredPercent = totalSplit > 0 ? (registeredRevenue / totalSplit) * 100 : 0;
        const guestPercent = totalSplit > 0 ? (guestRevenue / totalSplit) * 100 : 0;

        // 5. Recent Transactions
        const { data: recentOrders } = await supabase
            .from('orders')
            .select('id, order_number, customer_id, guest_name, total_amount, status, payment_method, placed_at')
            .order('placed_at', { ascending: false })
            .limit(6);

        return res.status(200).json({
            user,
            metrics: {
                todayOrders,
                todaySales,
                pendingOrders: pendingCount || 0
            },
            newAccounts: {
                today: todayAcq.count || 0,
                week: weekAcq.count || 0,
                month: monthAcq.count || 0,
                last3Months: threeMonthAcq.count || 0
            },
            revenueSplit: {
                registeredRevenue,
                registeredPercent,
                guestRevenue,
                guestPercent,
                totalRevenue: totalSplit
            },
            recentOrders: (recentOrders || []).map(o => ({
                ...o,
                customer_name: o.customer_id ? `Member #${o.customer_id}` : o.guest_name
            }))
        });

    } catch (err) {
        console.error('Server error on dashboard:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}