-- 作业: job_ads_rpt_gen  客户资产日报生成
CREATE PROCEDURE proc_ads_rpt_gen(IN p_data_dt VARCHAR(8))
BEGIN
    DELETE FROM ads_cust_asset_rpt WHERE data_dt = p_data_dt;

    INSERT INTO ads_cust_asset_rpt
        (org_no, cust_level, cust_cnt, asset_amt, txnl_amt, data_dt)
    SELECT
        a.org_no,
        a.cust_level,
        COUNT(a.cust_id),
        SUM(a.bal_amt_sum),
        SUM(a.txnl_amt_sum),
        p_data_dt
    FROM dws_cust_asset_d a
    JOIN dim_org o ON a.org_no = o.org_no
    WHERE a.data_dt = p_data_dt
    GROUP BY a.org_no, a.cust_level;
END;
