# Khách lý tưởng và thang chấm điểm

Tài liệu nội bộ. Bước chấm điểm khách (`leads.qualify`) đọc tài liệu này. Kết quả chấm điểm không bao giờ gửi cho khách.

## Khách lý tưởng

- **Ngành:** cửa hàng bán lẻ, tiệm hoa, spa và thẩm mỹ, salon, phòng khám nhỏ, công ty dịch vụ (làm web, sửa chữa, đào tạo nhỏ).
- **Quy mô:** chủ kiêm quản lý, đội 2 đến 15 người.
- **Kênh:** khách nhắn qua Zalo, Telegram hoặc Facebook; nhận tiền bằng chuyển khoản.
- **Nỗi đau rõ:** sót tin khách, trả lời chậm ngoài giờ, quên nhắn lại khách, đối soát chuyển khoản bằng tay, không biết việc nào đang bị bỏ quên.
- **Đã có tài liệu:** có bảng giá, chính sách (dù chỉ là ảnh hoặc tin ghim). Có tài liệu thì agent trả lời được ngay.

## Dấu hiệu loại

Có một dấu hiệu dưới đây thì đánh `unfit` bất kể điểm:

- Cần kênh NIVO chưa có làm kênh chính duy nhất (ví dụ chỉ bán qua Facebook Messenger, hoặc chỉ TikTok Shop) và không chịu chờ.
- Muốn AI tự gửi mọi thứ, không ai duyệt, cho các việc có rủi ro (giá, tiền, cam kết pháp lý) và không đổi ý sau khi được giải thích.
- Muốn mua để bán lại hoặc làm đối thủ tìm hiểu.
- Yêu cầu tính năng NIVO không có làm điều kiện bắt buộc (chạy quảng cáo tự động, dựng video tự động, phần mềm kế toán đầy đủ).
- Khách đã xin "không liên hệ".

## Thang điểm (0 đến 100)

| tiêu chí           | điểm tối đa | cách chấm                                                                                                                             |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Ngành              | 20          | đúng nhóm khách lý tưởng 20; gần giống 10; khác hẳn 0                                                                                 |
| Quy mô đội         | 15          | 2 đến 15 người 15; làm một mình 8; trên 15 người 8                                                                                    |
| Kênh đang dùng     | 15          | Zalo hoặc Telegram là kênh chính 15; Facebook là chính, Zalo là phụ 8; chỉ kênh NIVO chưa có 0                                        |
| Nỗi đau            | 20          | nói rõ một nỗi đau NIVO giải được, kèm ví dụ 20; nói chung chung 10; không nói 0                                                      |
| Tín hiệu ngân sách | 15          | hỏi giá xong vẫn tiếp tục, hoặc đang trả tiền cho công cụ hay người làm việc này 15; hỏi giá rồi im 5; nói thẳng không có ngân sách 0 |
| Thời điểm          | 15          | muốn bắt đầu trong tháng này 15; trong quý 8; chưa biết 3                                                                             |

Mỗi tiêu chí ghi một dòng lý do, trích câu khách đã nói. Thiếu thông tin thì chấm mức thấp và ghi "chưa hỏi" để người bán hỏi thêm.

## Mức điểm

<!-- placeholder -->

| điểm       | mức           | việc tiếp theo                                            |
| ---------- | ------------- | --------------------------------------------------------- |
| 80 đến 100 | Nóng          | mời demo ngay, báo người bán trong ngày                   |
| 60 đến 79  | Đạt chuẩn     | chuyển `qualified`, mời demo                              |
| 25 đến 59  | Đang tìm hiểu | giữ `engaged`, nhắn lại theo nhịp, gửi video đúng nỗi đau |
| 0 đến 24   | Chưa hợp      | chuyển `unfit`, dừng nhắn, ghi lý do                      |

Các ngưỡng 60 và 25 khớp với cài đặt `qualifyAt` và `dropBelow` của agent Chăm khách. Đổi ngưỡng thì đổi cả hai chỗ.

## Câu hỏi khai thác (dùng tự nhiên trong cuộc trò chuyện, không hỏi dồn)

- Anh/chị đang bán gì, khách thường nhắn qua đâu?
- Mỗi ngày khoảng bao nhiêu tin khách? Ai đang trả lời?
- Việc gì trong ngày làm anh/chị mất thời gian nhất?
- Đang nhận tiền bằng cách nào? Ai kiểm tra tiền về?
- Đội mình mấy người?
- Anh/chị muốn bắt đầu khi nào?
