-- 作业: job_dwd_txnl_clean  交易日明细清洗入 DWD 层
CREATE PROCEDURE proc_dwd_txnl_clean(IN p_data_dt VARCHAR(8))
BEGIN
    DELETE FROM dwd_txnl_detail_d WHERE data_dt = p_data_dt;

    INSERT INTO dwd_txnl_detail_d
        (txnl_id, cust_id, acct_no, txnl_type, txnl_amt, txnl_dt, data_dt)
    SELECT
        t.txnl_id,
        c.cust_id,
        t.acct_no,
        t.txnl_type,
        t.txnl_amt,
        t.txnl_dt,
        p_data_dt
    FROM ods_txnl_detail t
    LEFT JOIN dim_cust c ON t.acct_no = c.acct_no
    WHERE t.etl_dt = p_data_dt
      AND t.txnl_amt > 0;

    -- 余额挂靠客户维表补充登记客户号
    UPDATE dwd_txnl_detail_d d
       SET d.cust_id = (SELECT b.cust_id FROM dim_cust b WHERE b.acct_no = d.acct_no)
     WHERE d.data_dt = p_data_dt AND d.cust_id IS NULL;
END;
