/**
 * Report.gs
 * Dashboard + รายงานอายุหนี้ (aging report)
 */

/**
 * data สำรับ dashboard
 * - ยอดขายเดือนนี้
 * - ลูกหนี้ค้างชำระแยกอายุหนี้ (0-30 / 31-60 / 60+)
 * - งานค้างส่ง
 */
function getDashboard() {
  assertRole_();
  try {
    var now = new Date();
    var todayStr = dateStr_(now);
    var thisMonthPrefix = todayStr.slice(0, 7); // YYYY-MM

    var orders = repoRows_('Orders', false);
    var payments = repoRows_('Payments', false);

    var monthSales = 0;
    for (var p = 0; p < payments.length; p++) {
      var pay = payments[p];
      if (pay.status === 'ACTIVE' && String(pay.pay_date || '').indexOf(thisMonthPrefix) === 0) {
        monthSales += Number(pay.amount || 0);
      }
    }

    // ลูกหนี้แยกอายุ
    var aging = { '0-30': 0, '31-60': 0, '60+': 0, total: 0 };
    var pendingDeliveries = 0;
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (o.status === 'CANCELLED') continue;

      var balance = Number(o.balance || 0);
      if (balance > 0.01) {
        // อายุหนี้: นับจาก due_date
        var dueDate = new Date(String(o.due_date) + 'T00:00:00');
        var days = Math.floor((now - dueDate) / 86400000);
        if (days <= 30) aging['0-30'] += balance;
        else if (days <= 60) aging['31-60'] += balance;
        else aging['60+'] += balance;
        aging.total += balance;
      }

      // งานค้างส่ง (ยังไม่ส่งของ แต่ไม่ใช่ DRAFT/CANCELLED)
      var needDelivery = ['QUOTED', 'CONFIRMED', 'IN_PRODUCTION', 'PARTIAL_PAID'];
      if (needDelivery.indexOf(String(o.status)) >= 0) pendingDeliveries++;
    }

    var recentOrders = orders.slice().reverse().slice(0, 10);

    return {
      ok: true,
      data: {
        month_sales: monthSales,
        aging: aging,
        pending_deliveries: pendingDeliveries,
        recent_orders: recentOrders,
        today: todayStr
      },
      message: ''
    };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

/**
 * รายงานอายุหนี้แยกรายลูกค้า
 */
function getAgingReport() {
  assertRole_();
  try {
    var now = new Date();
    var orders = repoRows_('Orders', false);
    var customers = repoRows_('Customers', false);
    var customerMap = {};
    for (var c = 0; c < customers.length; c++) customerMap[customers[c].id] = customers[c];

    var result = [];
    var totals = { '0-30': 0, '31-60': 0, '60+': 0, total: 0 };

    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (o.status === 'CANCELLED') continue;
      var balance = Number(o.balance || 0);
      if (balance <= 0.01) continue;
      var dueDate = new Date(String(o.due_date) + 'T00:00:00');
      var days = Math.floor((now - dueDate) / 86400000);
      var bucket = days <= 30 ? '0-30' : (days <= 60 ? '31-60' : '60+');
      totals[bucket] = round2_(totals[bucket] + balance);
      totals.total = round2_(totals.total + balance);

      var cust = customerMap[o.customer_id] || {};
      result.push({
        customer_name: o.customer_name || cust.name || '',
        doc_no: o.doc_no,
        due_date: o.due_date,
        balance: balance,
        days_overdue: days > 0 ? days : 0,
        bucket: bucket
      });
    }

    return { ok: true, data: { rows: result, totals: totals }, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}
