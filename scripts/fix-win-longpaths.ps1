# Windows 专用：绕开 ninja 的 260 字符对象路径限制。
# 做法：把各原生库 codegen 生成目录 / common cpp 目录挂成短路径联接，
# 并改写其 jni/CMakeLists.txt 里的长路径变量。只应作用于「构建副本」目录。
param([Parameter(Mandatory=$true)][string]$ProjectDir)

$libs = @(
  @{ pkg = 'react-native-safe-area-context'; short = 'sac'; common = $true },
  @{ pkg = 'react-native-screens';           short = 'scr'; common = $false }
)

foreach ($lib in $libs) {
  $pkgDir = Join-Path $ProjectDir ("node_modules\" + $lib.pkg)
  if (-not (Test-Path -LiteralPath $pkgDir)) { continue }

  $codegen = Join-Path $pkgDir 'android\build\generated\source\codegen'
  $cgLink  = "D:\cg\" + $lib.short
  New-Item -ItemType Directory -Force -Path 'D:\cg' | Out-Null
  if (-not (Test-Path -LiteralPath $cgLink)) { cmd /c mklink /J $cgLink $codegen | Out-Null }

  $cmake = Join-Path $pkgDir 'android\src\main\jni\CMakeLists.txt'
  if (Test-Path -LiteralPath $cmake) {
    $c = [System.IO.File]::ReadAllText($cmake)
    $c = $c.Replace('set(LIB_ANDROID_GENERATED_JNI_DIR ${LIB_ANDROID_DIR}/build/generated/source/codegen/jni)',
                    ("set(LIB_ANDROID_GENERATED_JNI_DIR D:/cg/" + $lib.short + "/jni)"))
    $c = $c.Replace('set(LIB_ANDROID_GENERATED_COMPONENTS_DIR ${LIB_ANDROID_GENERATED_JNI_DIR}/react/renderer/components/${LIB_LITERAL})',
                    ('set(LIB_ANDROID_GENERATED_COMPONENTS_DIR D:/cg/' + $lib.short + '/jni/react/renderer/components/' + '${LIB_LITERAL})'))
    if ($lib.common) {
      $common = Join-Path $pkgDir 'common\cpp'
      $ccLink = "D:\cc\" + $lib.short
      New-Item -ItemType Directory -Force -Path 'D:\cc' | Out-Null
      if (-not (Test-Path -LiteralPath $ccLink)) { cmd /c mklink /J $ccLink $common | Out-Null }
      $c = $c.Replace('set(LIB_COMMON_DIR ${LIB_ANDROID_DIR}/../common/cpp)',
                      ("set(LIB_COMMON_DIR D:/cc/" + $lib.short + ")"))
    }
    [System.IO.File]::WriteAllText($cmake, $c, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output ("patched " + $cmake)
  }
}
Write-Output 'win-longpath fix done'