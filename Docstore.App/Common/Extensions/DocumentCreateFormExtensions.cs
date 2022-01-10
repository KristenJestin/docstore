using Docstore.App.Data;
using Docstore.App.Models.Forms;
using Microsoft.EntityFrameworkCore;

namespace Docstore.App.Common.Extensions
{
    public static class DocumentCreateFormExtensions
    {

        public static async Task<ICollection<DocumentFile>> UploadAndGetFilesAsync(this DocumentCreateForm form, IWebHostEnvironment hostingEnvironment)
        {
            var files = new List<DocumentFile>();

            foreach (var file in form!.Files)
            {
                var uploaded = await file.UploadAndTransformToDocumentFileAsync(hostingEnvironment);
                files.Add(uploaded);
            }

            return files;
        }

        public static async Task<ICollection<DocumentTag>> CreateNewTagsAndGetListAsync(this DocumentCreateForm form, AppDbContext context)
        {
            if (!form.Tags.Any())
                return new List<DocumentTag>();

            var userTags = form.GetTags();
            var userTagSlugs = userTags.Select(t => t.Slug);

            var existingTags = await context.DocumentTags.Where(t => userTagSlugs.Contains(t.Slug)).ToListAsync();

            var tagToCreate = userTags.Except(existingTags);

            // return all
            return tagToCreate.Concat(existingTags).ToList();
        }


        #region privates
        private static IEnumerable<DocumentTag> GetTags(this DocumentCreateForm form)
        {
            return form.Tags
                .Where(tag => !string.IsNullOrWhiteSpace(tag))
                .Distinct()
                .Select(TransformToDocumentTag);
        }

        private static DocumentTag TransformToDocumentTag(string tag)
            => new()
            {
                Name = tag.Trim(),
                Slug = Helpers.Slugify(tag.Trim()),
            };

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
                await file.CopyToAsync(stream);

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
        #endregion
    }
}
