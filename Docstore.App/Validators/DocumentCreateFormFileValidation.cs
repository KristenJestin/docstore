using Docstore.Domain.Entities;
using FluentValidation;
using Humanizer;

namespace Docstore.App.Validators
{
    public class DocumentCreateFormFileValidation : AbstractValidator<IFormFile>
    {
        public DocumentCreateFormFileValidation()
        {
            RuleFor(x => x.Length).NotNull().LessThanOrEqualTo(Document.MaxLength)
                .WithMessage($"File size is larger than allowed ({Document.MaxLength.Bytes()})");

            RuleFor(x => x.ContentType).NotNull().Must(x => Document.AllowedContentTypes.Contains(x))
                .WithMessage("File type is larger than allowed");
        }
    }
}
