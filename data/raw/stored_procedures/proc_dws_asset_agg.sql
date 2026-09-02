-- 作业: job_dws_asset_agg  客户资产日汇总
CREATE PROCEDURE proc_dws_asset_agg(IN p_data_dt VARCHAR(8))
BEGIN
    DELETE FROM dws_cust_asset_d WHERE data_dt = p_data_dt;

    INSERT INTO dws_cust_asset_d
        (cust_id, org_no, cust_level, txnl_cnt, txnl_amt_sum, bal_amt_sum, data_dt)
    SELECT
        d.cust_id,
        c.org_no,
        c.cust_level,
        COUNT(d.txnl_id),
        SUM(d.txnl_amt),
        SUM(b.bal_amt),
        p_data_dt
    FROM dwd_txnl_detail_d d
    JOIN dim_cust c ON d.cust_id = c.cust_id
    LEFT JOIN ods_acct_bal b ON d.acct_no = b.acct_no AND b.etl_dt = p_data_dt
    WHERE d.data_dt = p_data_dt
    GROUP BY d.cust_id, c.org_no, c.cust_level;
END;
