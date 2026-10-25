# Quiz Lab — Website độc lập, vẫn dùng Google Sheets làm dữ liệu

Bản này chuyển **giao diện học sinh/giáo viên** sang website tĩnh chạy trên Netlify để không còn thanh thông báo Google Apps Script ở phía trên trang. Google Apps Script vẫn xử lý nghiệp vụ và lưu dữ liệu trong Google Sheets như hiện tại; không chuyển sang cơ sở dữ liệu mới.

## Các tệp trong gói

- `site/index.html`: giao diện Quiz Lab để Netlify đăng tải.
- `netlify/functions/quizlab-api.js`: cầu nối máy chủ để trình duyệt gọi Apps Script cùng nguồn, tránh lỗi CORS trong trình duyệt.
- `netlify.toml`: cấu hình thư mục website và hàm Netlify.
- `apps-script/Code.gs`: mã Apps Script có bổ sung API `doPost` và chức năng chuyển quyền quản lý từ website cũ.
- `apps-script/Index.html`: giao diện tương thích để tiếp tục mở Apps Script cũ và sao chép mã quản lý cũ nếu cần chuyển dữ liệu.

## Phần A — Cập nhật Apps Script

1. Mở đúng dự án Quiz Lab hiện tại tại https://script.google.com/.
2. Sao lưu nội dung `Code.gs` hiện tại. Sau đó thay nội dung `Code.gs` bằng `apps-script/Code.gs` trong gói này.
3. Thay nội dung tệp HTML tên **`Index`** bằng `apps-script/Index.html` trong gói. Giữ tên tệp là `Index`, không đổi thành `Index.html` hoặc `Index_loading_link_delete` trong danh sách tệp Apps Script.
4. Lưu dự án. Chọn **Triển khai → Quản lý bản triển khai → Chỉnh sửa → Phiên bản mới → Triển khai**.
5. Trong cài đặt Web app, chọn **Thực thi với tư cách: Tôi** và **Ai có quyền truy cập: Bất kỳ ai (Anyone)** nếu tài khoản cho phép. Cầu nối Netlify gọi từ máy chủ, không có phiên đăng nhập Google của học sinh; tuỳ chọn chỉ cho người đã đăng nhập thường sẽ không dùng được.
6. Sao chép URL Web app kết thúc bằng `/exec`. Không gửi mã riêng hay mật khẩu Google cho ai.

Không cần chạy lại `setupQuizLab()` nếu Quiz Lab hiện tại đã hoạt động và đã có dữ liệu.

## Phần B — Đăng tải website lên Netlify

1. Tải ZIP và giải nén trên máy tính.
2. Tạo một repository trên GitHub. Bạn có thể để repository riêng tư. Tải **các nội dung bên trong thư mục `QuizLab_Standalone`** lên repository, sao cho `netlify.toml` nằm ngay ở thư mục gốc; giữ nguyên các thư mục `site`, `netlify` và `apps-script`.
3. Đăng nhập Netlify, chọn **Add new site / Import an existing project**, kết nối repository vừa tạo.
4. Cấu hình build như sau nếu Netlify không tự đọc `netlify.toml`: **Publish directory** là `site`, **Functions directory** là `netlify/functions`; không cần lệnh build.
5. Trong phần biến môi trường của site Netlify, thêm biến:
   - **Key:** `QUIZLAB_GAS_URL`
   - **Value:** URL Apps Script Web app đã sao chép ở Phần A, đầy đủ và kết thúc bằng `/exec`.
6. Triển khai lại site. Mở địa chỉ Netlify được cấp, ví dụ `https://ten-site.netlify.app/`. Chia sẻ **địa chỉ Netlify** này cho học sinh; liên kết bài sẽ tự tạo theo dạng `https://ten-site.netlify.app/?join=12345678`.

## Phần C — Chuyển đề cũ sang website mới (quan trọng nếu bạn đã có đề)

Do `localStorage` của trình duyệt được phân tách theo website, mã quản lý riêng của trình duyệt cũ không tự chuyển sang tên miền Netlify. Bản này có công cụ chuyển mã quản lý để giữ quyền sở hữu dữ liệu hiện có.

1. Mở URL Apps Script cũ kết thúc bằng `/exec` và thêm `?exportOwnerKey=1` vào cuối, ví dụ `https://script.google.com/macros/s/ID/exec?exportOwnerKey=1`.
2. Một hộp thoại sẽ hiện mã quản lý cũ gồm 64 ký tự. Sao chép mã này; không chia sẻ công khai.
3. Mở website Netlify mới và thêm `?migrateOwner=1` vào cuối URL, ví dụ `https://ten-site.netlify.app/?migrateOwner=1`.
4. Dán mã quản lý cũ vào hộp thoại. Website sẽ chuyển quyền quản lý cho mã mới của trình duyệt Netlify. Sau đó tải lại trang và kiểm tra Thư viện đề/Báo cáo.

Hãy giữ bản sao lưu Apps Script/Google Sheet cho đến khi bạn đã kiểm tra được đề và báo cáo. Việc chuyển này chỉ cập nhật mã chủ sở hữu cho đề và bài giao; không xóa dòng dữ liệu cũ trong Google Sheets.

## Kiểm tra sau khi triển khai

- Trang chủ Netlify không còn thanh thông báo Apps Script.
- Tạo một đề thử, xuất bản, giao bài và mở link `?join=...` trong cửa sổ riêng tư.
- Nộp một bài thử rồi kiểm tra báo cáo.
- Thử xóa một đề/báo cáo thử trước khi dùng thật.

## Khắc phục nhanh

- **“Chưa cấu hình QUIZLAB_GAS_URL”**: kiểm tra biến môi trường trên Netlify, phải kết thúc bằng `/exec`, sau đó triển khai lại.
- **Lỗi quyền truy cập / HTML thay vì JSON**: kiểm tra Apps Script đã triển khai phiên bản mới chưa và Web app cho phép `Anyone` hay chưa.
- **Không thấy đề cũ**: hoàn tất Phần C trên đúng trình duyệt từng dùng để tạo đề. Không xóa dữ liệu Google Sheet.
- **404 `/.netlify/functions/quizlab-api`**: site chưa được triển khai như Netlify Functions hoặc không upload đúng `netlify.toml`/thư mục `netlify/functions`.

Lưu ý: đây là gói triển khai cần bạn kết nối tới tài khoản Apps Script và Netlify của mình. Chưa có cách nào để mình tự triển khai trực tiếp vào tài khoản của bạn từ cuộc trò chuyện này.
