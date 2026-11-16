# HANDOFF 2026-11-16 (cập nhật 10:00 giờ máy, FIX-0.7.8): nivo-lite

Viết cho phiên kế tiếp. Chủ dự án ("thầy") ra lệnh dừng mọi việc, merge sạch vào `main`, push kèm file này.
Nguồn chi tiết từng việc: `D:/starci-tmp/claude-20261105/lanes/decouple-20261113/R4-NOTES.md` (các mục `## DEPLOY`, `## PROD-WIRE`,
`## FIX-0.7.8`, `## PROD-OOM`, `## SEED-HOOK`, `## WS-404`, `## ASK-PAY`, `## ASK-FIX`, `## RUN-END`, `## CANCEL-GAP`, `## HARNESS-URGENT`, `## LANDING-BUILD`).

## 1. Production đang chạy gì

- Stack Swarm `nivo` trên một VPS: `app.nivo.vn` (console), `api.nivo.vn`, `nivo.vn` (landing).
- Release `14fc2ecce6a69164` = **v0.7.9** (commit `e0799c1e6`), deploy 16/11 ~09:25 giờ máy (FIX-0.7.8); trước đó `da7dc98f182a219e` = **v0.7.8** (`994811710`) và `2419b4cc5cf9e36a` = v0.7.7 (rollback chưa cần). Backup trước deploy trên manager (`nivo-lite-20261116T021256881Z.tar.age`, `…T022525955Z.tar.age`, giải mã thử 4 phần). Không có migration mới. Image: api `sha256:941c230f…`, web `sha256:9a469c53…`, landing `sha256:646fc6c4…` (có ảnh hoa ở `/images/demo/hoa/`); mcp, db giữ nguyên.
- Database: volume `nivo-engine_postgres-data-20261115`, đã seed. Dữ liệu production cũ (trước 15/11) nằm nguyên ở volume
  `nivo-engine_postgres-data` (không gắn vào stack) và bản nén mã hoá trong `/srv/nivo/archive-20261115/`; volume OpenClaw cũng còn.
  Xoá hẳn hai thứ này chờ lời thầy.
- Qdrant đã cài. OpenClaw đã gỡ service. App admin không nằm trong release (lỗi build tách server / client, chưa sửa).
- Một tài khoản chủ (email thầy tự đặt, mật khẩu thầy tự đặt), chủ của hai workspace:
  - "Tiệm hoa Hương Sen" `c10fef8d-e031-4e25-a950-b47fa06152be` (blocks-core): Telegram `72f2699d-…` và payOS `103ceb10-…` THẬT, đã kết nối;
    5 tài khoản sandbox. Bước `tell-order` của `sales.consult` ở chế độ hỏi trước (thẻ duyệt rồi mới gửi link).
  - "NIVO Web" `fac3b49a-0711-4bff-ae9e-97071b218294` (nivo-web-core): SePay `b76ca4fd-…` đã tạo (công tắc "tiền vào" đang TẮT),
    Zalo `16be4fa5-…` đã tạo, CHỜ thầy cấp quyền; 9 tài khoản sandbox; CRM vẫn là sandbox.
- `PROVIDER_SANDBOX_ENABLED=true` trên production. Một run chỉ ở một thế giới: run từ khách thật không dùng được tài khoản sandbox.

## 2. Đã chạy thật trên production tối 15/11 (thầy đóng vai khách qua Telegram)

Tư vấn → gợi ý mẫu → agent hỏi đội về giờ giao → chốt đơn `DH-20261115-0001` → thẻ duyệt → gửi link payOS thật → trả lời khách trong lúc
chờ tiền. CHƯA thấy chạy thật: tiền về qua payOS rồi khớp đơn và tin cảm ơn; mọi luồng của NIVO Web với khách thật.

## 3. v0.7.7 (đã deploy, đã chạy thử trên dev trước)

| Phần | Nội dung | Đã kiểm trên dev (sandbox, 16/11) |
|---|---|---|
| `feat/run-end` | Kết thúc một lần chạy ở mọi trạng thái, tạm dừng / chạy tiếp, dừng / chạy lại workflow (giữ hoặc bỏ sự kiện), "kết thúc tất cả", ô "báo khách một câu"; nút ở 4 chỗ | Đạt: kết thúc khi đang chờ khách / đang chờ duyệt / đang tạm dừng / đang chạy dở / đã kết thúc; tạm dừng rồi chạy tiếp (tin giữ lại được trả lời 1 lần); dừng workflow giữ sự kiện (chạy bù 1 lần) và bỏ sự kiện (ghi lại + 1 thông báo); kết thúc tất cả (51 lần, 0 tin tới khách); ô báo khách gửi 1 câu |
| `fix/cancel-gap` | `sales.consult` v34: khách xin huỷ lúc chờ tiền → thẻ duyệt cho chủ → huỷ đơn + rút yêu cầu payOS → báo khách | Đạt cả hai nhánh: Đồng ý (đơn huỷ, yêu cầu payOS sandbox huỷ, khách được báo, lần chạy đóng); Không (khách được báo giữ đơn, tiếp tục chờ tiền, rồi trả tiền → sau bán) |
| sửa thêm `609562a5f` | Nhận bản cập nhật mẫu trong console bị từ chối `GRAPH_TEMPLATE_EDITED` khi mẫu chèn bước giữa (consult v33 → v34): nay giữ thứ tự bước của mẫu; hai file sinh tự động (registry hash, graph seed) được sinh lại | Đạt (nhận v34 trên dev) |

Seed: `blocks-core-seed-standard` ghim lại `86a4fdd` (force, node-settings) và chạy one-shot trên production: consult = mẫu v34, 19 bước cửa done,
`tell-order`, `cancel-order`, `pay-cancel-order` hỏi trước; Telegram và payOS thật vẫn `connected`. NIVO Web không đụng.

Còn lệch so với bản vẽ / quan sát (không chặn phát hành, chưa sửa):
- Hộp "Kết thúc lần chạy?" ở đầu trang lần chạy và ở hàng bảng lần chạy KHÔNG có ô "Báo khách một câu" cho lần chạy tư vấn (web chỉ hiện khi
  nguồn lần chạy là `customer`, mà tư vấn do lễ tân gọi = `agent`). Thẻ "Cuộc trò chuyện" của khách và thẻ dừng thì có.
- Thẻ duyệt huỷ đơn có tiêu đề chung "AI cần bạn duyệt trước khi chạy nivo.tool.record.update", chưa phải "Huỷ đơn".
- Thông báo đội khi kết thúc ghi "Khách không nhận thêm tin nào" kể cả khi đã chọn báo khách; câu báo khách do model viết có thể hứa "nhân viên
  sẽ hỗ trợ". "Kết thúc tất cả" gửi một thông báo cho MỖI lần chạy. Thẻ đã kết thúc ghi "Quy trình đã chạy tiếp".
- (đã sửa ở 0.7.8, xem 3b: hộp báo khách, tên thẻ huỷ đơn, thông báo, kết thúc tất cả, chữ thẻ đã kết thúc)
- Chưa thấy chạy thật trên production: một lần huỷ đơn thật, một lần kết thúc / tạm dừng thật trong console.

## 3b. v0.7.8 và v0.7.9 (FIX-0.7.8, đã deploy; chi tiết và số đo trong R4-NOTES `## FIX-0.7.8`)

- v0.7.8: hộp "Báo khách một câu" hiện ở trang lần chạy và bảng lần chạy cho mọi lần chạy có khách (kể cả do lễ tân gọi); thẻ duyệt mang tên bước ("Huỷ đơn"); thông báo đội nói rõ khi đã báo khách một câu; "Kết thúc tất cả" gửi MỘT thông báo; thẻ của lần chạy đã kết thúc ghi "Lần chạy này đã kết thúc, không chạy tiếp"; "không liên hệ" chỉ khi khách nói rõ đừng nhắn tin (bỏ mua / huỷ đơn không phải) và `stop-keep` hỏi chủ trước (front-desk v28). Đã chạy thử trên dev (sandbox) với ảnh 1920 và 390.
- v0.7.8 sửa tải của trang lần chạy khi lần chạy đang chờ (PROD-OOM): đọc lại 3 giây một lần chỉ khi một bước đang chạy, 30 giây khi đang chờ, thưa dần tới 60 giây, dừng khi tab ẩn, không dựng lại trang khi dữ liệu không đổi. Số đo trên dev: 190 → 10 lần đọc và 374 → 0 lần bố cục lại trong 10 phút; heap JS không tăng trước hay sau sửa trong 20 phút (không tái hiện được lỗi hết bộ nhớ của Chrome ở máy headless; nếu tab của thầy vẫn chết sau nhiều giờ thì cần heap snapshot của chính tab đó).
- v0.7.9 (dữ liệu): giá demo của "Tiệm hoa Hương Sen" 2.000–10.000 đ (giữ thứ tự), phí giao 1.000 đ, ảnh sản phẩm do Codex CLI sinh (mỗi sản phẩm một ảnh, trong truth "Ảnh" và bảng giá; bot gửi đường dẫn). Seed `blocks-core-seed-standard` ghim `4e32f52` với `force` + `forceKinds: ["node-settings","truths"]`, đã chạy one-shot trên production. Chưa đọc lại giá trên production (chỉ thấy đúng trên dev); thầy nhắn thử "bó hồng giá bao nhiêu".
- Sổ sách: `app release gate --backfill` cho v0.7.7 / 0.7.8 / 0.7.9 bị từ chối vì lockfile còn trỏ registry local (`DEPS_LOCAL_REGISTRY_COMMITTED`) và cache-verify của CI đỏ; cần làm mục nợ lockfile ở phần 6 rồi chạy gate trên tag mới. Dòng "drift: updated outside a release" của `stack verify` đứng riêng là do so với stack file của checkout (digest giả toàn số 0); `stack status` sạch, `stack accept` trả "already accepted".

## 4. Cách deploy (đường thủ công, đã chạy 6 lần tối 15/11)

Chi tiết và dòng lệnh: `## SEED-HOOK` (final), `## WS-404`, `## ASK-FIX` trong R4-NOTES.
1. Bước phát hành khẩn (kiểm `typecheck`, `build-be`, `build-fe`; tag; bản ghi). Lệnh một bước `app release push --urgent` từ chối vì
   lockfile trỏ registry local (`DEPS_LOCAL_REGISTRY_COMMITTED`), nên chạy riêng bước 1 của nó.
2. Build image ở máy này (builder thường, mạng host, registry local `127.0.0.1:4873` phải chạy), đẩy lên GHCR. Image db: dùng lại digest
   đang chạy (gói GHCR `nivo-lite-db` đang private).
3. `starci-harness@1.1.0-alpha.128+` : `app stack deploy --env production --urgent --sha <sha> --image <svc>=<ref>@sha256:…` (xem trước
   rồi `--execute`). Backup lấy trên server. KHÔNG `--first-start`, KHÔNG `--db-url-env`.
4. Push `main` và tag. Hook pre-push từ chối `BRANCH_MAIN_NOT_ON_DEV` (xem mục 6): thầy cho phép `--no-verify` cho app này; không force.
Lưu ý (0.7.8): bước kiểm khẩn cấp cần `node scripts/codegen.mjs` trước nếu checkout chưa sinh lại kiểu GraphQL; build image bằng `docker build --network host --push` (builder `nivo-hostnet` không nạp ảnh về máy); khi đổi ghim seed, deploy với ghim cũ rồi chạy `seed-standards-oneshot` (dry rồi execute).
Mỗi lúc một người phát hành. Ổ D: phải còn ít nhất 15 GB trước khi build.

## 5. Lỗi và việc còn mở

- Hiển thị bước chờ duyệt: đã sửa ở 0.7.6 ("Chờ bạn" → "Xong"); chưa ai nhìn thấy trên production sau khi sửa.
- Đăng nhập trên Chrome có dữ liệu cũ: đã sửa ở 0.7.5 (`@starci/auth` 0.7.1); chưa có xác nhận từ Chrome của thầy.
- "Dừng đi không mua nữa" bị đọc thành "đừng nhắn tôi nữa": đã sửa ở 0.7.8 (xem 3b); chưa thấy trên production.
- Console có nút kết thúc / tạm dừng lần chạy từ v0.7.7.
- Trang tài khoản sandbox hiện form và cảnh báo của tài khoản thật: dễ hiểu nhầm là thiếu credential.
- NIVO Web: Zalo chờ cấp quyền; sau đó hai bước `webdesk.front` `answer` / `complaint-reply` cần gắn `zalo-main` (chạy lại seed có ép,
  hoặc chọn tay trong console). Webhook SePay và Zalo thầy tự dán bên hãng (URL trong `D:/.claude/.scratch-owner/nivo-prod-credentials-20261115.md`).
- Một run hộp thư sandbox của NIVO Web dừng ở bước `to-tickets`, chưa rõ nguyên nhân.
- CRM (`nivo-web-lite`) chưa deploy: chờ thầy quyết domain, gateway, cách khôi phục dữ liệu (`## CRM-DEPLOY`).
- Landing mới đã chạy trên `nivo.vn`; còn chờ: giá và dùng thử, các trang con, ảnh console thật, màu chữ xám.
- Các lượt kiểm đầy đủ sau phát hành khẩn (v0.7.0 … v0.7.6) chưa chạy; 295 lỗi kiểu trong file spec; gate tắt theo lời thầy.
- Matrix vòng 3 đã dừng: `…/matrix-core-20261114/round3/FINAL3.md` (các lỗi engine còn mở liệt kê ở đó).
- Mật khẩu chủ từng hiện trong một ảnh chụp gửi vào chat: nên đổi.

## 6. Nợ kỹ thuật của repo

- `dev` (origin, bản 0.6.0 ngày 8/11) và `main` tách nhau: `dev` có 67 commit (các vòng lint / Sonar) `main` không có. Chưa merge;
  đề xuất chưa được thầy trả lời: cho `dev` lấy nguyên nội dung `main`. Vì vậy mọi lần push `main` phải bỏ hook.
- Lockfile còn ~20 mục lấy từ registry local. Mọi gói cần đã có trên npm (`@starci/hfs` 6.13.4, `starci-harness` 1.1.0-alpha.129,
  `@starci/auth` 0.7.1, `@starci/ai-router` 0.7.0; `@starci/common` về 1.0.1, `@starci/visual-effects` về 0.1.0). Việc chuyển sang npm
  + áp hai patch tắt gate (`…/decouple-20261113/patches/`) + `app sync` chưa làm.
- Nhánh không dùng nữa (không merge): `feat/auth-onboarding-ux` (nội dung đã ở `main`), `feat/cells-v2` (V2 chuyển sang repo
  `nivoos/nivoos-lite`), `feat/nivo-dev`, `feat/landing-v2` / `feat/run-end` / `fix/cancel-gap` (đã merge).
- Cây `D:/starci-lanes/nivo-auth-ux` (dev stack chạy từ đó) ở commit cũ `9bd8ce7f8` + 22 file sửa chưa commit là bản sao của code đã
  có trên `main`: có thể bỏ, sau đó đưa cây về `main`.

## 7. Máy local

- Ổ D: hay đầy (đĩa ảo Docker `D:\docker\DockerDesktopWSL\disk\docker_data.vhdx`, đã nén 00:05 ngày 16/11: 123,8 → 96,6 GB; còn ~25 GB
  trống). Trong Docker còn ~945 volume không dùng (~45 GB): chưa xoá, chờ lời thầy.
- Dev stack: container (Postgres, Redis, Qdrant, MinIO) và registry local đang chạy; api dev (18787) và web dev (3100) KHÔNG chạy.
- Harness (`D:/.claude`): `main` = `86272c821`, đã push; ba nhánh local chưa đưa lên: `pkg/claude-canon-be-health-signals`,
  `pkg/claude-secret-init-names` (xong, chưa phát hành), `pkg/claude-lint-grammar-split` (xung đột).
- V2: repo `nivoos/nivoos-lite` (`D:/Repositories/nivoos-lite`) do một phiên khác làm; xem `HANDOFF.md` của repo đó.

## 8. Việc thầy cần quyết (chưa có trả lời)

1. `dev` lấy nguyên nội dung `main`?
2. Xoá hẳn volume database cũ và volume OpenClaw trên production?
3. CRM: domain, gateway, cách khôi phục dữ liệu (`-backup-prod`).
4. Landing: giá, dùng thử, trang con, câu chuyện NIVO Web.
5. Xoá ~945 volume Docker không dùng trên máy local?
