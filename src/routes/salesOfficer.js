// POST /api/sales-officer/z-reading
router.post('/z-reading', async (req, res) => {
    try {
        const { actual_cash, expected_cash, variance, digital_inflow, cashier_name, notes } = req.body;

        const reportCode = `Z-${Date.now()}`;

        // I-save sa bagong shift_z_reports table
        const { data: insertedReport, error: dbError } = await supabase
            .from('shift_z_reports')
            .insert({
                z_report_code: reportCode,
                cashier_name: cashier_name || 'Employee',
                expected_cash: parseFloat(expected_cash) || 0,
                actual_cash: parseFloat(actual_cash) || 0,
                variance: parseFloat(variance) || 0,
                digital_inflow: parseFloat(digital_inflow) || 0,
                status: 'PENDING_RECONCILIATION',
                notes: notes || 'Official Shift Z-Reading Transmitted from Sales Counter'
            })
            .select()
            .single();

        if (dbError) {
            console.error('Database Insertion Error:', dbError);
            return res.status(500).json({ error: dbError.message });
        }

        // I-update ang system lock sa system_settings
        await supabase
            .from('system_settings')
            .upsert({
                setting_key: 'register_status',
                setting_value: 'LOCKED',
                description: 'Sales counter register lock state after Z-reading'
            }, { onConflict: 'setting_key' });

        return res.json({
            status: 'success',
            message: 'Z-Report successfully recorded',
            data: insertedReport
        });

    } catch (err) {
        console.error('Server error on Z-Reading:', err);
        return res.status(500).json({ error: 'Server error processing Z-Reading' });
    }
});