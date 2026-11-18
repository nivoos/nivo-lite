# Tính năng

## Agent

- Mỗi agent là một "nhân viên AI" có vai, có các luồng việc riêng và có một người chịu trách nhiệm.
- Agent đọc tài liệu trong Second Brain, đọc lịch sử trò chuyện với khách, đọc và ghi dữ liệu chung của công ty (đơn hàng, khách tiềm năng, lịch hẹn...).
- Bạn chọn mô hình AI cho từng bước: bước đơn giản dùng mô hình nhanh và rẻ, bước cần suy nghĩ kỹ (viết kịch bản, chấm điểm khách) dùng mô hình mạnh hơn.

## Luồng việc

- Một luồng việc là chuỗi bước cố định: chờ, đọc, soạn, gửi, ghi lại. Mỗi bước làm một việc.
- Luồng việc bắt đầu khi khách nhắn, khi tiền về tài khoản, khi một dữ liệu đổi trạng thái, hoặc theo lịch (mỗi sáng thứ Hai, mỗi tối 21:00...).
- Luồng việc biết chờ: chờ khách trả lời, chờ chuyển khoản trong một khoảng thời gian, chờ đến giờ đăng bài. Hết hạn chờ thì làm bước dự phòng (nhắc lại, huỷ đơn, báo người).
- Một việc gửi đi đã làm thì không bị làm lại hai lần, kể cả khi hệ thống khởi động lại giữa chừng.
- Khi một bước lỗi hoặc không biết trả lời, luồng việc dừng tại đó và hiện một thẻ cho người phụ trách xử lý.

## Duyệt

- Mỗi bước có hai chế độ: **tự chạy** hoặc **hỏi trước**.
- Bước hỏi trước hiện thành thẻ trong Office và trong danh sách chờ duyệt: gửi cho ai, nội dung gì, số tiền bao nhiêu, ai phụ trách, hạn duyệt.
- Người duyệt bấm Duyệt hoặc Từ chối, có thể kèm ghi chú. Từ chối thì không có gì được gửi.
- Người trong đội có thể giành lại một cuộc trò chuyện (tiếp quản). Khi đó agent không gửi tin vào cuộc đó nữa, tin người gõ vẫn đi bình thường. Xong thì trả lại cho agent.

## Trách nhiệm

- Màn Trách nhiệm gom mọi việc đang mở của đội và của agent: việc gì, của khách nào, bước tiếp theo, hạn, trạng thái (đang mở, chờ duyệt, quá hạn, đã xong).
- Mỗi bước tự động hoá có danh sách người chịu trách nhiệm theo thứ tự. Khi bước đó dừng hoặc lỗi, NIVO giao việc cho người đầu tiên còn chỗ. Mỗi người có giới hạn số việc đang mở (mặc định 5). Cả danh sách đều đủ việc thì giao cho người đang ít việc nhất.
- Bước chưa chọn ai thì việc đi tới người chịu trách nhiệm của agent.

## Second Brain

- Tải lên tài liệu PDF, Word (.docx), Markdown hoặc văn bản thường. NIVO đọc, chia đoạn và rút ra các điều đã chốt (giá, giờ mở cửa, chính sách...).
- Ảnh (sản phẩm, mẫu) được NIVO tự mô tả. Ảnh nào được một tài liệu nhắc tới thì agent mới dùng, ví dụ gửi đúng ảnh mẫu khi khách hỏi.
- Hai phần: **Công khai** (agent trả lời khách chỉ đọc phần này) và **Nội bộ** (chỉ đội và các việc nội bộ đọc). Tài liệu mới tải lên mặc định vào Nội bộ cho tới khi bạn chuyển.
- Hai tài liệu nói khác nhau thì NIVO không tự chọn: nó tạo một đề xuất thay đổi để bạn quyết.
- Mỗi lần sửa tài liệu là một phiên bản mới, bản cũ vẫn được giữ.
- Mỗi tệp tối đa 50 MB.

## Office

- Phòng chung của cả nhóm và phòng riêng của từng agent.
- Agent chỉ trả lời trong phòng chung khi được @ nhắc tên, hoặc khi bạn nhắn trong phòng riêng của nó.
- Thẻ duyệt, báo cáo hằng ngày, cảnh báo việc kẹt đều hiện trong phòng.

## Khách hàng và Đầu vào

- Tin khách từ các kênh đã kết nối vào chung một chỗ (Đầu vào), mỗi khách một hồ sơ.
- Hồ sơ khách ghi người phụ trách, giai đoạn, nguồn, ghi chú nội bộ, việc tiếp theo và hạn. Tab "Cần liên hệ hôm nay" cho biết hôm nay phải gọi ai.
- Đánh dấu "Không liên hệ" thì không ai và không agent nào được nhắn cho khách đó.
- Nhập danh sách khách từ tệp CSV; số điện thoại hoặc email trùng thì gộp vào khách cũ, không tạo bản trùng.

## Kết nối

Đang có:

- **Zalo OA**: nhận và gửi tin với khách qua Official Account của bạn.
- **Telegram**: bot nhận và gửi tin.
- **SePay**: nhận biến động số dư, khớp chuyển khoản với đơn theo mã nội dung.
- **PayOS**: nhận thanh toán.
- **Google Drive và Google Sheets**: đọc tài liệu, ghi bảng tính.
- **Email**: hộp thư công ty để gửi và nhận thư.
- **Công cụ bên ngoài (MCP)**: nối NIVO với công cụ khác (quảng cáo, quản trị...). Mỗi công cụ mặc định tắt, bạn bật từng cái. Công cụ có thể thay đổi dữ liệu bên kia thì AI chỉ được đề xuất, một bước riêng mới thực hiện.

Chưa có (đang làm hoặc dự kiến): Facebook (Page, Messenger), TikTok, YouTube, Google Calendar, dựng video tự động. NIVO sẽ báo khi có.

## Credit

Mỗi lần agent dùng AI để đọc, soạn hoặc tra cứu là tốn credit. Bước không dùng AI (gửi một tin đã duyệt, ghi dữ liệu, chờ chuyển khoản) không tốn credit. Xem chi tiết ở tài liệu "Credit hoạt động thế nào".
