using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace ExileTradeLens.Ggpk;

internal sealed class Datc64Table {
    private static readonly byte[] Magic = [0xBB, 0xBB, 0xBB, 0xBB, 0xBB, 0xBB, 0xBB, 0xBB];
    private readonly byte[] data;
    private readonly int variableDataOffset;

    public Datc64Table(string path, byte[] data) {
        Path = path;
        this.data = data;
        if (data.Length < 12) throw new InvalidDataException($"DATC64 is too small: {path}");

        RowCount = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(data));
        if (RowCount <= 0) throw new InvalidDataException($"DATC64 has no rows: {path}");

        MagicOffset = FindMagicOffset(data, RowCount);
        if (MagicOffset < 0) throw new InvalidDataException($"DATC64 boundary not found: {path}");

        var fixedSize = MagicOffset - sizeof(uint);
        if (fixedSize % RowCount != 0) {
            throw new InvalidDataException($"DATC64 row geometry is invalid: {path}");
        }
        RowSize = fixedSize / RowCount;
        variableDataOffset = MagicOffset + Magic.Length;
        Sha256 = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    }

    public string Path { get; }
    public int RowCount { get; }
    public int RowSize { get; }
    public int MagicOffset { get; }
    public string Sha256 { get; }

    public ReadOnlySpan<byte> GetRow(int rowIndex) {
        if ((uint)rowIndex >= (uint)RowCount) throw new ArgumentOutOfRangeException(nameof(rowIndex));
        var offset = sizeof(uint) + (rowIndex * RowSize);
        return data.AsSpan(offset, RowSize);
    }

    public int ReadInt32(int rowIndex, int fieldOffset) {
        var row = GetField(rowIndex, fieldOffset, sizeof(int));
        return BinaryPrimitives.ReadInt32LittleEndian(row);
    }

    public long ReadInt64(int rowIndex, int fieldOffset) {
        var row = GetField(rowIndex, fieldOffset, sizeof(long));
        return BinaryPrimitives.ReadInt64LittleEndian(row);
    }

    public string ReadString(int rowIndex, int fieldOffset) {
        var rawPointer = ReadInt64(rowIndex, fieldOffset);
        var relativeOffset = rawPointer - Magic.Length;
        if (relativeOffset < 0 || relativeOffset > data.Length - variableDataOffset) return string.Empty;

        var start = checked(variableDataOffset + (int)relativeOffset);
        var end = start;
        while (end + 1 < data.Length) {
            if (data[end] == 0 && data[end + 1] == 0) break;
            end += 2;
        }
        if (end <= start || end + 1 >= data.Length) return string.Empty;
        return Encoding.Unicode.GetString(data, start, end - start);
    }

    public string ReadHex(int rowIndex, int fieldOffset, int length) =>
        Convert.ToHexString(GetField(rowIndex, fieldOffset, length));

    private ReadOnlySpan<byte> GetField(int rowIndex, int fieldOffset, int length) {
        if (fieldOffset < 0 || length < 0 || fieldOffset + length > RowSize) {
            throw new InvalidDataException(
                $"Field [{fieldOffset}, {fieldOffset + length}) exceeds row size {RowSize} in {Path}");
        }
        return GetRow(rowIndex).Slice(fieldOffset, length);
    }

    private static int FindMagicOffset(ReadOnlySpan<byte> source, int rowCount) {
        var searchOffset = sizeof(uint);
        while (searchOffset <= source.Length - Magic.Length) {
            var relative = source[searchOffset..].IndexOf(Magic);
            if (relative < 0) return -1;
            var candidate = searchOffset + relative;
            if ((candidate - sizeof(uint)) % rowCount == 0) return candidate;
            searchOffset = candidate + 1;
        }
        return -1;
    }
}
