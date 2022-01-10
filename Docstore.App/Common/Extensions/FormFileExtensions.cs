using Docstore.App.Data;

namespace Docstore.App.Common.Extensions
{
    public static class FormFileExtensions
    {
        public static async Task<DocumentFile> UploadAndTransformToDocumentFileAsync(this IFormFile file, IWebHostEnvironment environment)
        {
            // move to directory
            var paths = new List<string> { environment.WebRootPath };
            paths.AddRange(DocumentFile.StorePath);
            var storedFileName = Helpers.GetUniqueFileName();

            var uploads = Path.Combine(paths.ToArray());
            var filePath = Path.Combine(uploads, storedFileName);

            Directory.CreateDirectory(uploads);
            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            // TODO: encrypt file

            // transform to entity
            var fileNameWithoutExtension = Path.GetFileNameWithoutExtension(file.FileName);
            return new DocumentFile
            {
                Name = fileNameWithoutExtension,
                OriginalName = fileNameWithoutExtension,
                Extension = Path.GetExtension(file.FileName).Replace(".", ""),
                Size = file.Length,
                StoredName = storedFileName,
                MimeType = file.ContentType
            };
        }
    }
}
