namespace Docstore.Application.Models.DTO
{
    public class GetDocumentFileDto
    {
        public int Id { get; set; }
        public string? Name { get; set; }
        public string? OriginalName { get; set; }
        public string? Extension { get; set; }
        public long Size { get; set; }
        public string? MimeType { get; set; }
    }
}
