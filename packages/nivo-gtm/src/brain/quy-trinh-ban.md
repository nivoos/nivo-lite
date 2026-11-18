# Quy trình bán

Tài liệu nội bộ cho agent Chăm khách, agent Chốt đơn và người bán. Kênh nói chuyện với khách hiện là **Telegram** (bot NIVO nhắn riêng, kênh và nhóm thảo luận của NIVO). Facebook sẽ thêm sau.

## Các giai đoạn của khách

| giai đoạn     | nghĩa                                              | ai giữ             | việc tiếp theo                         |
| ------------- | -------------------------------------------------- | ------------------ | -------------------------------------- |
| `new`         | vừa nhắn lần đầu, hoặc vừa vào từ bình luận, sheet | Chăm khách         | trả lời câu đầu, hỏi nhu cầu           |
| `engaged`     | đã trao đổi                                        | Chăm khách         | trả lời, khai thác, nhắn lại theo nhịp |
| `qualified`   | điểm từ 60                                         | Chăm khách         | mời demo                               |
| `demo_booked` | đã chốt giờ demo                                   | người chủ trì demo | nhắc trước giờ, chuẩn bị               |
| `demo_done`   | đã demo                                            | người bán          | tóm tắt, báo giá                       |
| `won`         | đã trả tiền và kích hoạt                           | người bán          | chào mừng, bàn giao                    |
| `cold`        | nhắn lại đủ số lần không trả lời                   | Chăm khách         | xem lại sau 30 ngày                    |
| `unfit`       | không hợp                                          | không ai           | dừng nhắn                              |
| `lost`        | đã từ chối                                         | người bán          | ghi lý do                              |

## Nhịp làm việc

1. **Trả lời lần đầu.** Gom tin khách nhắn liền (chờ khoảng 20 giây), hiểu khách muốn gì, trả lời từ tài liệu công khai. Mọi tin gửi đi đều qua người duyệt.
2. **Ghi nguồn.** Khách vào từ link có mã `start=` thì ghi bài đăng nguồn để biết bài nào ra khách.
3. **Chấm điểm** sau khi khách nói ít nhất 3 lượt, hoặc khi khách hỏi giá hay muốn demo. Xem "Khách lý tưởng và thang chấm điểm".
4. **Nhắn lại** khi khách im: sau 1, 3, 7 và 14 ngày, tối đa 4 lần, chỉ trong 08:00 đến 21:00. Mỗi lần nhắn phải có giá trị mới (một video đúng nỗi đau, một câu trả lời cho điều khách băn khoăn), không nhắn "anh chị còn quan tâm không". Hết 4 lần thì chuyển `cold`. Khách nhắn lại giữa chừng thì dừng nhịp nhắn và trả lời bình thường.
5. **Mời demo.** Gửi 3 khung giờ trống gần nhất. Khách không chọn trong 48 giờ thì quay lại nhịp nhắn lại.
6. **Chốt demo.** Ghi lịch, gửi xác nhận kèm link, báo người chủ trì qua Telegram. Nhắc khách 2 giờ trước giờ demo.
7. **Sau demo** (khoảng 1 giờ sau giờ kết thúc): người chủ trì chọn Đã demo, Khách vắng hoặc Dời lịch, kèm ghi chú.
8. **Bàn giao cho người bán.** Agent Chốt đơn tóm tắt: khách là ai, cần gì, băn khoăn gì, gói đề xuất. Thẻ hiện trong phòng `#ban-hang` và nhắn Telegram cho người bán.
9. **Báo giá.** Người bán chọn gói, số tháng, gói nạp credit. Con số do bước tính giá tính, không do AI viết. Giảm giá theo "Chính sách giảm giá nội bộ".
10. **Thanh toán.** Khách đồng ý thì tạo mã thanh toán `NIVO<mã đơn>`, gửi hướng dẫn chuyển khoản. Chờ 72 giờ. Chưa thấy tiền thì nhắc một lần (cần duyệt), sau đó báo người bán.
11. **Kích hoạt.** Tiền về thì thẻ giao người kích hoạt. Người kích hoạt bật gói trong trang quản trị nền tảng, trong 24 giờ, rồi bấm "Đã kích hoạt".
12. **Chào mừng.** Gửi tin chào mừng (cần duyệt), chuyển khách sang `won`.

## Quy tắc cứng

- Chỉ nói giá, credit, ưu đãi có trong tài liệu "Gói và giá". Không hứa tính năng chưa có. Không hứa ngày ra mắt tính năng.
- Khách hỏi điều tài liệu công khai không có: không đoán, báo người bán.
- Khách đang là khách hàng NIVO cần hỗ trợ sản phẩm: chuyển cho đội hỗ trợ, không bán thêm trong lúc khách đang gặp lỗi.
- Khách xin không nhắn nữa: đánh dấu không liên hệ ngay.
- Thứ Sáu 16:00 xem lại khách mất và khách nguội trong tuần: lý do, lời từ chối, khách đã xem nội dung nào.

## Bàn giao giữa người

- Người bán nhận khách theo vòng lần lượt trong danh sách người bán, hoặc là người đã chủ trì demo.
- Ai giữ khách thì người đó là chủ việc tiếp theo trên màn Trách nhiệm, với hạn rõ ràng.
