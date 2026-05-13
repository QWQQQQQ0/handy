// 来源: lib/services/desktop/desktop_native_service.dart → captureDesktop

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
    GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, SRCCOPY, HDC, HBITMAP,
};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

struct ScopedDC(HDC);
impl Drop for ScopedDC {
    fn drop(&mut self) {
        unsafe { let _ = DeleteDC(self.0); }
    }
}

struct ScopedBitmap(HBITMAP);
impl Drop for ScopedBitmap {
    fn drop(&mut self) {
        unsafe { let _ = DeleteObject(self.0); }
    }
}

struct ScopedScreenDC(HDC);
impl Drop for ScopedScreenDC {
    fn drop(&mut self) {
        unsafe { let _ = ReleaseDC(None, self.0); }
    }
}

#[tauri::command]
pub fn desktop_screenshot() -> Result<String, String> {
    let (width, height) = unsafe {
        (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN))
    };

    let hdc = unsafe { GetDC(None) };
    if hdc.is_invalid() {
        return Err("Failed to get desktop DC".into());
    }
    let _screen_dc = ScopedScreenDC(hdc);

    let h_bitmap = unsafe { CreateCompatibleBitmap(hdc, width, height) };
    if h_bitmap.is_invalid() {
        return Err("Failed to create compatible bitmap".into());
    }
    let _bitmap = ScopedBitmap(h_bitmap);

    let h_mem_dc = unsafe { CreateCompatibleDC(hdc) };
    let _mem_dc = ScopedDC(h_mem_dc);

    let old_bitmap = unsafe { SelectObject(h_mem_dc, h_bitmap) };

    let _ = unsafe {
        BitBlt(
            h_mem_dc, 0, 0, width, height,
            hdc, 0, 0,
            SRCCOPY,
        )
    };

    let mut bi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [Default::default()],
    };

    let buffer_size = (width * height * 4) as usize;
    let mut pixels: Vec<u8> = vec![0u8; buffer_size];

    unsafe {
        GetDIBits(
            h_mem_dc,
            h_bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bi,
            DIB_RGB_COLORS,
        );
    }

    // BGRA → RGBA
    for i in (0..buffer_size).step_by(4) {
        let b = pixels[i];
        let r = pixels[i + 2];
        pixels[i] = r;
        pixels[i + 2] = b;
        pixels[i + 3] = 255;
    }

    unsafe {
        SelectObject(h_mem_dc, old_bitmap);
    }
    // Drop guards clean up: h_mem_dc, h_bitmap, hdc

    // Encode to BMP + base64
    let mut bmp_data: Vec<u8> = Vec::new();
    let file_size = 54 + pixels.len() as u32;
    bmp_data.extend_from_slice(&[b'B', b'M']);
    bmp_data.extend_from_slice(&file_size.to_le_bytes());
    bmp_data.extend_from_slice(&[0u8; 4]);
    bmp_data.extend_from_slice(&54u32.to_le_bytes());
    bmp_data.extend_from_slice(&40u32.to_le_bytes());
    bmp_data.extend_from_slice(&width.to_le_bytes());
    bmp_data.extend_from_slice(&height.to_le_bytes());
    bmp_data.extend_from_slice(&1u16.to_le_bytes());
    bmp_data.extend_from_slice(&32u16.to_le_bytes());
    bmp_data.extend_from_slice(&0u32.to_le_bytes());
    bmp_data.extend_from_slice(&(pixels.len() as u32).to_le_bytes());
    bmp_data.extend_from_slice(&[0u8; 16]);
    bmp_data.extend_from_slice(&pixels);

    let base64_str = BASE64.encode(&bmp_data);
    Ok(format!("data:image/bmp;base64,{}", base64_str))
}
