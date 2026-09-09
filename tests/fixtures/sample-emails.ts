export const validAcbCreditEmail = {
  subject: 'Thông báo biến động số dư tài khoản ACB',
  bodyText: `
Kính gửi Quý khách,
ACB xin thông báo biến động số dư tài khoản như sau:
Số tài khoản: 123456789
Loại giao dịch: Báo Có (+)
Số tiền giao dịch: +500,000 VND
Thời gian: 09/09/2026 15:30:00
Nội dung: NGUYEN VAN A chuyen tien REF987654
Số dư hiện tại: 12,500,000 VND
Cảm ơn Quý khách đã sử dụng dịch vụ của ACB.
`,
};

export const validAcbDebitEmail = {
  subject: 'Thông báo biến động số dư tài khoản ACB',
  bodyText: `
Kính gửi Quý khách,
ACB xin thông báo biến động số dư tài khoản như sau:
Số tài khoản: 123456789
Loại giao dịch: Báo Nợ (-)
Số tiền giao dịch: -150,000 VND
Thời gian: 09/09/2026 16:00:00
Nội dung: Thanh toan hoa don dien nuoc
Số dư hiện tại: 12,350,000 VND
Cảm ơn Quý khách đã sử dụng dịch vụ của ACB.
`,
};

export const invalidFormatEmail = {
  subject: 'Khuyến mãi đặc biệt từ ACB mừng sinh nhật',
  bodyText: `
Nhận ngay quà tặng khủng khi mở tài khoản tiết kiệm online tại ACB ngay hôm nay!
`,
};

export const forgedHeaderEmail = `From: "ACB Bank" <alert@acb.com.vn>
To: recipient@example.com
Subject: Thông báo biến động số dư tài khoản ACB
Authentication-Results: attacker.com; dkim=pass header.d=attacker.com
Received: from mail.attacker.com ...

Body with fake credit.
`;
