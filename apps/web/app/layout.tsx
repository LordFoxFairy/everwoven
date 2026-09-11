import type { Metadata } from 'next';
import './globals.css';
import {TRPCReactProvider} from '../trpc/react';
export const metadata: Metadata = {title:'未完 · 用户驱动的互动视频世界',description:'配置你的故事，与角色一起，让下一幕发生。交互原型。'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="zh-CN"><body><TRPCReactProvider>{children}</TRPCReactProvider></body></html>}
