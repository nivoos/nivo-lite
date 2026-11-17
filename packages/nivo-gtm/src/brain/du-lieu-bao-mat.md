
# Dữ liệu và bảo mật

## Dữ liệu ở trong workspace của bạn

- Mỗi doanh nghiệp có một workspace riêng. Khách hàng, tin nhắn, đơn hàng, tài liệu của bạn chỉ nằm trong workspace đó.
- Mọi lần tìm kiếm của agent đều chỉ trong workspace của bạn.

## Phần công khai và phần nội bộ

- Second Brain chia hai phần. Agent trả lời khách **chỉ đọc phần Công khai**. Bảng lương, giá vốn, quy trình nội bộ để ở phần Nội bộ thì không bao giờ lọt vào câu trả lời cho khách.
- Tài liệu mới tải lên mặc định nằm ở Nội bộ cho tới khi bạn chuyển sang Công khai.
- Ảnh tải lên được xoá thông tin vị trí và thiết bị chụp đi kèm ảnh.

## Agent chỉ làm những gì được cho phép

- Mỗi bước của agent được khai báo trước là được đọc gì và được làm gì. Ngoài ra thì bị chặn.
- Bước gửi ra ngoài (tin cho khách, báo giá, bài đăng) luôn phải có người duyệt, không tắt được; duyệt được trên Telegram bằng nút.
- Công cụ bên ngoài nối qua MCP mặc định **tắt**. Bạn bật từng công cụ. Công cụ có thể thay đổi dữ liệu bên kia thì AI không được tự gọi: AI chỉ đề xuất, người duyệt, rồi một bước riêng mới thực hiện.

## Khoá truy cập và mật khẩu kết nối

- Khoá của các kết nối (Zalo OA, Telegram, SePay, Google, công cụ MCP) được mã hoá khi lưu và không bao giờ hiện ra màn hình, nhật ký hay báo cáo.

## Tệp và đường dẫn

- Tệp lưu trong kho lưu trữ riêng, không có thư mục công khai. Mỗi lần xem tệp là một đường dẫn có chữ ký, hết hạn sau thời gian ngắn.

## Lịch sử và xoá

- Mọi thay đổi dữ liệu đều ghi lại ai sửa, lúc nào (người hay agent, ở bước nào). Hai người sửa cùng lúc thì người sau được báo, không ghi đè im lặng.
- Xoá tài liệu hay dữ liệu là xoá mềm: bản cũ vẫn được giữ trong lịch sử.
- Xoá hẳn một khách hàng (theo yêu cầu của khách) sẽ dừng mọi việc đang chờ liên quan tới khách đó và xoá tên, tin nhắn của họ.

## Quyền trong đội

- Có các vai Chủ sở hữu, Quản lý và Nhân viên. Việc quan trọng như xoá khách chỉ Chủ sở hữu làm được.

<!-- placeholder -->
## Còn đang cập nhật

Nơi đặt máy chủ và chính sách dữ liệu với nhà cung cấp mô hình AI: đang cập nhật. Khi khách hỏi, người phụ trách bán hàng sẽ trả lời trực tiếp.
