using Docstore.Domain.Entities;

namespace Docstore.Domain.Extensions
{
    public static class DocumentFileExtensions
    {
        public static string GetFilePath(this DocumentFile file, string basePath)
        {
            var paths = new List<string> { basePath };
            paths.AddRange(DocumentFile.StorePath);
            var uploads = Path.Combine(paths.ToArray());

            return Path.Combine(uploads, file.StoredName!);
        }
    }
}
