$root = "D:\"
$entries = @()

# Get all items in root
Get-ChildItem -Path $root -Force | ForEach-Object {
    $item = $_
    if ($item.PSIsContainer) {
        # Calculate folder size recursively
        $size = (Get-ChildItem -Path $item.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $entries += [PSCustomObject]@{
            Name = $item.Name
            Type = "Folder"
            Size = $size
            SizeMB = [math]::Round($size / 1MB, 2)
        }
    } else {
        $entries += [PSCustomObject]@{
            Name = $item.Name
            Type = "File"
            Size = $item.Length
            SizeMB = [math]::Round($item.Length / 1MB, 2)
        }
    }
}

# Sort by size descending
$entries | Sort-Object Size -Descending | Select-Object Name, Type, @{N='Size';E={'{0:N2} MB' -f $_.SizeMB}} | Format-Table -AutoSize