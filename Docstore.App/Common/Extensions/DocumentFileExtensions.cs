using Docstore.Domain.Entities;

namespace Docstore.App.Common.Extensions
{
    public static class DocumentFileExtensions
    {
        public static string GetFilePath(this DocumentFile file, IWebHostEnvironment environment)
        {
            var paths = new List<string> { environment.WebRootPath };
            paths.AddRange(DocumentFile.StorePath);
            var uploads = Path.Combine(paths.ToArray());

            return Path.Combine(uploads, file.StoredName!);
        }
    }
}
