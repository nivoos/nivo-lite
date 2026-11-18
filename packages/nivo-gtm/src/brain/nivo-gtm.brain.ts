// NIVO Tăng trưởng's second brain as classes: each document is a Markdown file next to this file (written by the coordinator; public = what a customer may be told, internal = the playbook).
// Interim: the S-STD lane replaces these files with the seed standard.
import { brainFile, type BrainDocument } from "@starci/nivoos-sdk"
import { keyOf } from "../package-key.ts"

/** The public brain document (what a customer may be told) "Câu chuyện khách hàng", read from ./cau-chuyen-khach-hang.md. */
export class CauChuyenKhachHang implements BrainDocument {
    readonly key = keyOf("cau-chuyen-khach-hang")
    readonly area = "public"
    readonly title = { vi: "Câu chuyện khách hàng", en: "Câu chuyện khách hàng" }
    readonly source = brainFile("./cau-chuyen-khach-hang.md")
}

/** The public brain document (what a customer may be told) "Hỏi đáp", read from ./cau-hoi-thuong-gap.md. */
export class CauHoiThuongGap implements BrainDocument {
    readonly key = keyOf("cau-hoi-thuong-gap")
    readonly area = "public"
    readonly title = { vi: "Hỏi đáp", en: "Hỏi đáp" }
    readonly source = brainFile("./cau-hoi-thuong-gap.md")
}

/** The public brain document (what a customer may be told) "Credit hoạt động thế nào", read from ./credit.md. */
export class Credit implements BrainDocument {
    readonly key = keyOf("credit")
    readonly area = "public"
    readonly title = { vi: "Credit hoạt động thế nào", en: "Credit hoạt động thế nào" }
    readonly source = brainFile("./credit.md")
}

/** The public brain document (what a customer may be told) "Demo và dùng thử", read from ./demo-dung-thu.md. */
export class DemoDungThu implements BrainDocument {
    readonly key = keyOf("demo-dung-thu")
    readonly area = "public"
    readonly title = { vi: "Demo và dùng thử", en: "Demo và dùng thử" }
    readonly source = brainFile("./demo-dung-thu.md")
}

/** The public brain document (what a customer may be told) "Dữ liệu và bảo mật", read from ./du-lieu-bao-mat.md. */
export class DuLieuBaoMat implements BrainDocument {
    readonly key = keyOf("du-lieu-bao-mat")
    readonly area = "public"
    readonly title = { vi: "Dữ liệu và bảo mật", en: "Dữ liệu và bảo mật" }
    readonly source = brainFile("./du-lieu-bao-mat.md")
}

/** The public brain document (what a customer may be told) "Giới thiệu NIVO", read from ./gioi-thieu.md. */
export class GioiThieu implements BrainDocument {
    readonly key = keyOf("gioi-thieu")
    readonly area = "public"
    readonly title = { vi: "Giới thiệu NIVO", en: "Giới thiệu NIVO" }
    readonly source = brainFile("./gioi-thieu.md")
}

/** The public brain document (what a customer may be told) "Gói và giá", read from ./goi-va-gia.md. */
export class GoiVaGia implements BrainDocument {
    readonly key = keyOf("goi-va-gia")
    readonly area = "public"
    readonly title = { vi: "Gói và giá", en: "Gói và giá" }
    readonly source = brainFile("./goi-va-gia.md")
}

/** The public brain document (what a customer may be told) "Thanh toán", read from ./thanh-toan.md. */
export class ThanhToan implements BrainDocument {
    readonly key = keyOf("thanh-toan")
    readonly area = "public"
    readonly title = { vi: "Thanh toán", en: "Thanh toán" }
    readonly source = brainFile("./thanh-toan.md")
}

/** The public brain document (what a customer may be told) "Tính năng NIVO", read from ./tinh-nang.md. */
export class TinhNang implements BrainDocument {
    readonly key = keyOf("tinh-nang")
    readonly area = "public"
    readonly title = { vi: "Tính năng NIVO", en: "Tính năng NIVO" }
    readonly source = brainFile("./tinh-nang.md")
}

/** The internal brain document (the playbook, never shown to a customer) "Các lựa chọn khác khách hay nhắc", read from ./doi-thu.md. */
export class DoiThu implements BrainDocument {
    readonly key = keyOf("doi-thu")
    readonly area = "internal"
    readonly title = { vi: "Các lựa chọn khác khách hay nhắc", en: "Các lựa chọn khác khách hay nhắc" }
    readonly source = brainFile("./doi-thu.md")
}

/** The internal brain document (the playbook, never shown to a customer) "Chính sách giảm giá nội bộ", read from ./giam-gia-noi-bo.md. */
export class GiamGiaNoiBo implements BrainDocument {
    readonly key = keyOf("giam-gia-noi-bo")
    readonly area = "internal"
    readonly title = { vi: "Chính sách giảm giá nội bộ", en: "Chính sách giảm giá nội bộ" }
    readonly source = brainFile("./giam-gia-noi-bo.md")
}

/** The internal brain document (the playbook, never shown to a customer) "Giọng thương hiệu", read from ./giong-thuong-hieu.md. */
export class GiongThuongHieu implements BrainDocument {
    readonly key = keyOf("giong-thuong-hieu")
    readonly area = "internal"
    readonly title = { vi: "Giọng thương hiệu", en: "Giọng thương hiệu" }
    readonly source = brainFile("./giong-thuong-hieu.md")
}

/** The internal brain document (the playbook, never shown to a customer) "Khách lý tưởng và thang chấm điểm", read from ./khach-hang-ly-tuong.md. */
export class KhachHangLyTuong implements BrainDocument {
    readonly key = keyOf("khach-hang-ly-tuong")
    readonly area = "internal"
    readonly title = { vi: "Khách lý tưởng và thang chấm điểm", en: "Khách lý tưởng và thang chấm điểm" }
    readonly source = brainFile("./khach-hang-ly-tuong.md")
}

/** The internal brain document (the playbook, never shown to a customer) "Lịch tuần mẫu", read from ./lich-tuan-mau.md. */
export class LichTuanMau implements BrainDocument {
    readonly key = keyOf("lich-tuan-mau")
    readonly area = "internal"
    readonly title = { vi: "Lịch tuần mẫu", en: "Lịch tuần mẫu" }
    readonly source = brainFile("./lich-tuan-mau.md")
}

/** The internal brain document (the playbook, never shown to a customer) "Quy tắc duyệt", read from ./quy-tac-duyet.md. */
export class QuyTacDuyet implements BrainDocument {
    readonly key = keyOf("quy-tac-duyet")
    readonly area = "internal"
    readonly title = { vi: "Quy tắc duyệt", en: "Quy tắc duyệt" }
    readonly source = brainFile("./quy-tac-duyet.md")
}

/** The internal brain document (the playbook, never shown to a customer) "Quy trình bán", read from ./quy-trinh-ban.md. */
export class QuyTrinhBan implements BrainDocument {
    readonly key = keyOf("quy-trinh-ban")
    readonly area = "internal"
    readonly title = { vi: "Quy trình bán", en: "Quy trình bán" }
    readonly source = brainFile("./quy-trinh-ban.md")
}

/** The internal brain document (the playbook, never shown to a customer) "Trụ cột nội dung", read from ./tru-cot-noi-dung.md. */
export class TruCotNoiDung implements BrainDocument {
    readonly key = keyOf("tru-cot-noi-dung")
    readonly area = "internal"
    readonly title = { vi: "Trụ cột nội dung", en: "Trụ cột nội dung" }
    readonly source = brainFile("./tru-cot-noi-dung.md")
}

/** The internal brain document (the playbook, never shown to a customer) "Xử lý lời từ chối", read from ./xu-ly-tu-choi.md. */
export class XuLyTuChoi implements BrainDocument {
    readonly key = keyOf("xu-ly-tu-choi")
    readonly area = "internal"
    readonly title = { vi: "Xử lý lời từ chối", en: "Xử lý lời từ chối" }
    readonly source = brainFile("./xu-ly-tu-choi.md")
}

/** Every document of the workspace's brain. */
export const NIVO_GTM_BRAIN = [
    CauChuyenKhachHang,
    CauHoiThuongGap,
    Credit,
    DemoDungThu,
    DuLieuBaoMat,
    GioiThieu,
    GoiVaGia,
    ThanhToan,
    TinhNang,
    DoiThu,
    GiamGiaNoiBo,
    GiongThuongHieu,
    KhachHangLyTuong,
    LichTuanMau,
    QuyTacDuyet,
    QuyTrinhBan,
    TruCotNoiDung,
    XuLyTuChoi,
]
