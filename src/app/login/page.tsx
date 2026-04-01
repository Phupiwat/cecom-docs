import { signIn } from "@/auth"

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold">C</div>
          <h1 className="text-xl font-bold text-gray-900">Cecom Document System</h1>
          <p className="text-sm text-gray-500 text-center">บริษัท ซีคอม ดับเบิ้ลพลัส จำกัด</p>
        </div>
        <form
          action={async () => {
            "use server"
            await signIn("google", { redirectTo: "/" })
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg py-2.5 px-4 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
              <path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.5 20-21 0-1.3-.2-2.7-.5-4z" fill="#FFC107"/>
              <path d="M6.3 14.7l7 5.1C15.1 16.4 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 16.3 3 9.7 7.9 6.3 14.7z" fill="#FF3D00"/>
              <path d="M24 45c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.6C29.7 35.9 27 37 24 37c-6.1 0-10.7-3.1-11.8-8.5l-7 5.4C8.6 40.7 15.7 45 24 45z" fill="#4CAF50"/>
              <path d="M44.5 20H24v8.5h11.8c-.6 2.8-2.4 5.1-4.8 6.6l6.6 5.6C41.7 37 44.5 31 44.5 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2"/>
            </svg>
            เข้าสู่ระบบด้วย Google
          </button>
        </form>
        <p className="text-xs text-gray-400 text-center">เฉพาะบัญชีที่ได้รับอนุญาตเท่านั้น</p>
      </div>
    </div>
  )
}
