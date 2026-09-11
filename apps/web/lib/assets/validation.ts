export function validateImageFile(file:{type:string;size:number}){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 图片。');
 if(!Number.isFinite(file.size)||file.size<=0||file.size>10*1024*1024)throw Error('图片需大于 0 且不超过 10 MB。');
}
export function validateImageDimensions(width:number,height:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<256||height<256||width*height>24000000||Math.max(width,height)>8000)throw Error('图片每边至少 256 像素，最长边不超过 8000，且不超过 2400 万像素。');
}
