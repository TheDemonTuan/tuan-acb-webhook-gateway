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

export const currentAcbCreditEmail = {
  subject: 'Thông báo thay đổi số dư tài khoản ACB',
  bodyText: `
Kính gửi Quý khách hàng.

ACB trân trọng thông báo tài khoản 40478827 của Quý khách đã thay đổi số dư như sau:
Số dư mới của tài khoản trên là: 50,000.00 VND tính đến 10/09/2026.
Giao dịch mới nhất:Ghi có +50,000.00 VND.
Nội dung giao dịch: RUT TIEN TU VI MOMO 0844343536 CASHOUT 0844343536 146081426274 - 10092026 02:03:14 426274.

Cảm ơn Quý khách hàng đã sử dụng Sản phẩm/ Dịch vụ của ACB.
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
